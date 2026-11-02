import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, unlink, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import type {
  CameraGeometry,
  Frame,
  Pointing,
  TelescopeStatus,
} from '@vela/equipment'
import { decodeEvent, epochMs, rigId, seal, type Envelope } from '@vela/rig-events'
import type { RunLog } from '../run-log/run-log.js'
import type { PolarFit, Site } from '@vela/rig-sky'
import type { RejectedSolve } from '../plate-solving/rejected.js'
import { encodeCaptureFits } from '../imaging/fits.js'
import type { SkyPosition, SolveResult } from '../plate-solving/judged-solver.js'
import type { AlignmentMeasurement, AlignmentSample } from './geometry.js'
import {
  diagnosticRunInfoSchema,
  maximumFitsBytes,
  maximumFixes,
  type DroppedReason,
} from './diagnostic-schema.js'

export type AlignmentDiagnosticRunInfo = {
  runId: string
  rigId: string
  rigName: string
  cameraId: string
  telescopeId: string
  cameraName: string
  exposureSeconds: number
} & ({ mode: 'physical' } | { mode: 'offline'; simulator: Extract<Envelope<'alignment'>['body'], { mode: 'offline' }>['simulator'] })

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
  recordRejected(frame: Frame, position: number, verdict: RejectedSolve, claimed: SkyPosition): Promise<void>
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

/** FITS stay with the trial; numerical evidence goes to the shared run log. */
export function createAlignmentDiagnostics(
  root: string,
  log: Pick<RunLog, 'append'>,
  onError: (error: Error) => void,
): AlignmentDiagnosticsFactory {
  function report(error: Error) {
    try {
      onError(error)
    } catch {
    }
  }

  return async run => {
    let n = 0
    let baselineFrames = 0
    let latestAdjustment: string | undefined

    async function record(work: () => Promise<void>) {
      try {
        await work()
      } catch (error) {
        report(
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

      function append(body: Envelope<'alignment'>['body']) {
        const at = epochMs(Date.now())
        const decoded = decodeEvent({ v: 1, id: 'pending', rig: run.rigId, source: 'vela:alignment', kind: 'alignment', at, seenAt: at, body })

        if (!decoded.ok || decoded.event.kind !== 'alignment') throw new Error('Invalid alignment event')
        log.append(seal({ rig: rigId(run.rigId), source: decoded.event.source, kind: 'alignment', at, seenAt: at, body: decoded.event.body }))
      }

      const part = () => ({ runId: run.runId, n: ++n })

      append({ ...run, type: 'run', ...part(), folder: basename(directory) })

      return {
        recordRejected: (frame, position, verdict, claimed) =>
          record(async () => {
            let original = null

            try {
              const fits = await encodeCaptureFits(frame, run)
              const filename = `rejected-${randomUUID()}.fits`
              await writeFile(join(directory, filename), fits, { flag: 'wx' })
              original = { filename, sha256: createHash('sha256').update(fits).digest('hex') }
            } catch (error) {
              report(error instanceof Error ? error : new Error('Rejected pixels missing'))
            }

            append({ type: 'dropped', ...part(), position,
              reason: verdict.reasons.includes('no-match') ? 'no-solve' : 'rejected',
              detail: JSON.stringify({ ...verdict, claimed, original, pixels: original ? 'kept' : 'missing' }),
            })
          }),
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
            append({
              type: 'frame',
              ...part(),
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
        recordFit: (fixes, _latitudeDegrees, fit) =>
          record(async () => {
            const { axis, altitudeArcsec, azimuthArcsec, totalArcsec, verdict } = fit
            // A fit that is not rigid has no polar error, so none is journalled with it.
            const polar = verdict.status === 'rigid' ? { axis, altitudeArcsec, azimuthArcsec, totalArcsec } : null

            append({ type: 'fit', ...part(), fixes, polar, verdict })
          }),
        recordDropped: (position, reason, detail) =>
          record(async () =>
            append(
              { type: 'dropped', ...part(), position, reason, detail: detail?.slice(0, 500) ?? null },
            ),
          ),
        // Both current alignment modes measure with sidereal tracking enabled.
        recordMeasurement: (sample, measurement, mount) =>
          record(async () =>
            append({
              type: 'measurement',
              ...part(),
              sample,
              measurement,
              tracking: true,
              ...(mount && { mount }),
            }),
          ),
        finish: outcome =>
          record(async () => {
            append({ type: 'outcome', ...part(), ...outcome })
          }),
      }
    } catch (error) {
      report(
        error instanceof Error
          ? error
          : new Error('Alignment diagnostic recording failed', { cause: error }),
      )

      return undefined
    }
  }
}
