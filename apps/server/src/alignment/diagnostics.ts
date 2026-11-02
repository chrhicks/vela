import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir, mkdtemp, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type {
  CameraGeometry,
  Frame,
  Pointing,
  TelescopeStatus,
} from '@vela/equipment'
import type { PolarFit, RigidityVerdict, Site } from '@vela/rig-sky'
import { encodeCaptureFits } from '../imaging/fits.js'
import type { SkyPosition, SolveResult } from '../plate-solving/judged-solver.js'
import type { AlignmentMeasurement, AlignmentSample } from './geometry.js'
import {
  diagnosticEntrySchema,
  diagnosticJournalName,
  diagnosticRunInfoSchema,
  maximumFitsBytes,
  maximumFixes,
  maximumJournalBytes,
  type DiagnosticEntry,
  type DroppedReason,
} from './diagnostic-schema.js'

export type AlignmentDiagnosticRunInfo = {
  runId: string
  rigId: string
  rigName: string
  mode: 'offline' | 'physical'
  cameraId: string
  telescopeId: string
  cameraName: string
  exposureSeconds: number
}

export type AlignmentFrameEvidence = {
  phase: 'baseline' | 'adjusting'
  position: number
  solution: Extract<SolveResult, { status: 'solved' }>
  sample: AlignmentSample
  hint: SkyPosition
  fieldHeightDegrees: number
  physical?: {
    site: Site
    camera: CameraGeometry
    before: TelescopeStatus
    after: TelescopeStatus
  }
  offlinePointing?: Pointing
}

export interface AlignmentDiagnosticRun {
  recordFrame(frame: Frame, evidence: AlignmentFrameEvidence): Promise<void>
  recordBaseline(
    samples: readonly [AlignmentSample, AlignmentSample, AlignmentSample],
    latitudeDegrees: number,
    measurement: AlignmentMeasurement,
    rigidity?: RigidityVerdict,
  ): Promise<void>
  /** The polar axis fit over the good fixes of a sweep; `fixes` are their positions and samples. */
  recordFit(
    fixes: readonly { position: number; sample: AlignmentSample }[],
    latitudeDegrees: number,
    fit: PolarFit,
  ): Promise<void>
  /** A sweep position that gave no fix, and why. The sweep does not expose it again. */
  recordDropped(position: number, reason: DroppedReason, detail: string | null): Promise<void>
  recordMeasurement(
    sample: AlignmentSample,
    measurement: AlignmentMeasurement,
    mount?: TelescopeStatus,
  ): Promise<void>
  finish(outcome: { phase: 'finished' | 'stopped' | 'failed'; error: string | null }): Promise<void>
}

export type AlignmentDiagnosticsFactory = (
  run: AlignmentDiagnosticRunInfo,
) => Promise<AlignmentDiagnosticRun | undefined>

/** Opt-in evidence only. The controller awaits each call sequentially; a recording
 * failure disables this run without changing the outcome of any rig operation. */
export function createAlignmentDiagnostics(
  root: string,
  onError: (error: Error) => void,
): AlignmentDiagnosticsFactory {
  return async run => {
    let disabled = false
    let journalBytes = 0
    let baselineFrames = 0
    let latestAdjustment: string | undefined

    function disable(error: Error) {
      if (disabled) return
      disabled = true

      try {
        onError(error)
      } catch {
        // Even a failed reporting sink must not reject into a physical operation.
      }
    }

    async function record(work: () => Promise<void>) {
      if (disabled) return

      try {
        await work()
      } catch (error) {
        disable(
          error instanceof Error
            ? error
            : new Error('Alignment diagnostic recording failed', { cause: error }),
        )
      }
    }

    try {
      if (!isAbsolute(root)) throw new Error('Alignment diagnostic root must be absolute')
      diagnosticRunInfoSchema.parse(run)
      await mkdir(root, { recursive: true })
      const directory = await mkdtemp(join(root, `${run.runId}-`))
      const journal = join(directory, diagnosticJournalName)

      async function append(entry: DiagnosticEntry) {
        const line = `${JSON.stringify(entry)}\n`
        const bytes = Buffer.byteLength(line)

        if (journalBytes + bytes > maximumJournalBytes)
          throw new Error('Alignment diagnostic journal exceeds 4 MiB')
        await appendFile(journal, line)
        journalBytes += bytes
      }

      await append({ type: 'run', schemaVersion: 1, createdAt: new Date().toISOString(), run })

      return {
        recordFrame: (frame, evidence) =>
          record(async () => {
            // Bound allocation before scanning pixels, using the larger signed-32
            // encoding. Unsigned-16 output can be smaller; journal the actual size.
            const pixels = frame.width * frame.height
            const maximumEncodedBytes = 2880 + Math.ceil((pixels * 4) / 2880) * 2880

            if (
              !Number.isSafeInteger(pixels) ||
              pixels <= 0 ||
              maximumEncodedBytes > maximumFitsBytes
            ) {
              throw new Error('Alignment diagnostic FITS exceeds 128 MiB or has invalid dimensions')
            }

            if (evidence.phase === 'baseline' && baselineFrames >= maximumFixes)
              throw new Error(`Alignment diagnostics already has ${maximumFixes} baseline originals`)
            const fits = await encodeCaptureFits(frame, run)
            const filename = `${evidence.phase}-${randomUUID()}.fits`
            await writeFile(join(directory, filename), fits, { flag: 'wx' })
            await append({
              type: 'frame',
              original: {
                filename,
                bytes: fits.length,
                sha256: createHash('sha256').update(fits).digest('hex'),
              },
              capture: {
                width: frame.width,
                height: frame.height,
                capturedAt: frame.capturedAt,
                capturedAtSource: frame.capturedAtSource ?? 'camera',
                color: frame.color,
              },
              evidence,
            })

            if (evidence.phase === 'baseline') baselineFrames++
            else {
              const previous = latestAdjustment
              latestAdjustment = filename

              // New pixels never replace a file referenced by older numeric evidence.
              if (previous) await unlink(join(directory, previous))
            }
          }),
        recordBaseline: (samples, latitudeDegrees, measurement, rigidity) =>
          record(() =>
            append({
              type: 'baseline',
              samples,
              latitudeDegrees,
              measurement,
              ...(rigidity && { rigidity }),
            }),
          ),
        recordFit: (fixes, latitudeDegrees, fit) =>
          record(() => {
            const { axis, altitudeArcsec, azimuthArcsec, totalArcsec, verdict } = fit
            // A camera that never turned has no axis; a polar number is journalled only with the axis it came from.
            const polar = axis.every(Number.isFinite) ? { axis, altitudeArcsec, azimuthArcsec, totalArcsec } : null

            return append(diagnosticEntrySchema.parse({ type: 'fit', fixes, latitudeDegrees, polar, verdict }))
          }),
        recordDropped: (position, reason, detail) =>
          record(() =>
            append(
              diagnosticEntrySchema.parse({ type: 'dropped', position, reason, detail: detail?.slice(0, 500) ?? null }),
            ),
          ),
        // Both current alignment modes measure with sidereal tracking enabled.
        recordMeasurement: (sample, measurement, mount) =>
          record(() =>
            append({
              type: 'measurement',
              sample,
              measurement,
              tracking: true,
              mount,
            }),
          ),
        finish: outcome =>
          record(async () => {
            await append({ type: 'outcome', ...outcome })
            disabled = true
          }),
      }
    } catch (error) {
      disable(
        error instanceof Error
          ? error
          : new Error('Alignment diagnostic recording failed', { cause: error }),
      )

      return undefined
    }
  }
}
