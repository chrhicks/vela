import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir, mkdtemp, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { AlpacaCameraGeometry, AlpacaFrame, AlpacaPointing, AlpacaTelescopeStatus } from '@vela/alpaca'
import type { Site } from '../astronomy/coordinates.js'
import { encodeCaptureFits } from '../imaging/fits.js'
import type { SkyPosition, SolveResult } from '../plate-solving/solver.js'
import type { AlignmentMeasurement, AlignmentSample } from './geometry.js'
import { diagnosticJournalName, diagnosticRunInfoSchema, maximumFitsBytes, maximumJournalBytes, type DiagnosticEntry } from './diagnostic-schema.js'

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
  physical?: { site: Site, camera: AlpacaCameraGeometry, before: AlpacaTelescopeStatus, after: AlpacaTelescopeStatus }
  offlinePointing?: AlpacaPointing
}

export interface AlignmentDiagnosticRun {
  recordFrame(frame: AlpacaFrame, evidence: AlignmentFrameEvidence): Promise<void>
  recordBaseline(samples: readonly [AlignmentSample, AlignmentSample, AlignmentSample], latitudeDegrees: number, measurement: AlignmentMeasurement): Promise<void>
  recordMeasurement(sample: AlignmentSample, measurement: AlignmentMeasurement, mount?: AlpacaTelescopeStatus): Promise<void>
  finish(outcome: { phase: 'finished' | 'stopped' | 'failed', error: string | null }): Promise<void>
}

export type AlignmentDiagnosticsFactory = (run: AlignmentDiagnosticRunInfo) => Promise<AlignmentDiagnosticRun | undefined>

/** Opt-in evidence only. The controller awaits each call sequentially; a recording
 * failure disables this run without changing the outcome of any rig operation. */
export function createAlignmentDiagnostics(root: string, onError: (error: Error) => void): AlignmentDiagnosticsFactory {
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

      try { await work() } catch (error) {
        disable(error instanceof Error ? error : new Error('Alignment diagnostic recording failed', { cause: error }))
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

        if (journalBytes + bytes > maximumJournalBytes) throw new Error('Alignment diagnostic journal exceeds 4 MiB')
        await appendFile(journal, line)
        journalBytes += bytes
      }

      await append({ type: 'run', schemaVersion: 1, createdAt: new Date().toISOString(), run })

      return {
        recordFrame: (frame, evidence) => record(async () => {
          // encodeCaptureFits uses one 2880-byte header and padded signed-int32 samples.
          const pixels = frame.width * frame.height
          const bytes = 2880 + Math.ceil(pixels * 4 / 2880) * 2880

          if (!Number.isSafeInteger(pixels) || pixels <= 0 || bytes > maximumFitsBytes) {
            throw new Error('Alignment diagnostic FITS exceeds 128 MiB or has invalid dimensions')
          }

          if (evidence.phase === 'baseline' && baselineFrames >= 3) throw new Error('Alignment diagnostics already has three baseline originals')
          const fits = await encodeCaptureFits(frame, run)
          const filename = `${evidence.phase}-${randomUUID()}.fits`
          await writeFile(join(directory, filename), fits, { flag: 'wx' })
          await append({
            type: 'frame', original: { filename, bytes: fits.length, sha256: createHash('sha256').update(fits).digest('hex') },
            capture: { width: frame.width, height: frame.height, capturedAt: frame.capturedAt,
              capturedAtSource: frame.capturedAtSource ?? 'camera', color: frame.color },
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
        recordBaseline: (samples, latitudeDegrees, measurement) => record(() => append({ type: 'baseline', samples, latitudeDegrees, measurement })),
        // Both current alignment modes measure with sidereal tracking enabled.
        recordMeasurement: (sample, measurement, mount) => record(() => append({ type: 'measurement', sample, measurement, tracking: true, mount })),
        finish: outcome => record(async () => {
          await append({ type: 'outcome', ...outcome })
          disabled = true
        }),
      }
    } catch (error) {
      disable(error instanceof Error ? error : new Error('Alignment diagnostic recording failed', { cause: error }))

      return undefined
    }
  }
}
