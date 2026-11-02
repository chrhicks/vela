import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, writeFile, appendFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { encodeCaptureFits } from '../imaging/fits.js'
import { diagnosticJournalName, type DiagnosticEntry } from './diagnostic-schema.js'
import type { AlignmentDiagnosticRunInfo, AlignmentDiagnosticRun } from './diagnostics.js'

/** Old three-point journals for replay's corruption and backwards-compatibility tests. */
export function legacyTrialFixture(root: string) {
  return async (run: Omit<AlignmentDiagnosticRunInfo, 'mode' | 'simulator'> & { mode: 'physical' | 'offline' }): Promise<Pick<AlignmentDiagnosticRun, 'recordFrame' | 'recordMeasurement' | 'finish'>> => {
    await mkdir(root, { recursive: true })
    const directory = await mkdtemp(join(root, `${run.runId}-`))
    const append = async (entry: DiagnosticEntry) => { await appendFile(join(directory, diagnosticJournalName), `${JSON.stringify(entry)}\n`) }

    await append({ type: 'run', schemaVersion: 1, createdAt: new Date().toISOString(), run })
    let adjustment: string | undefined

    return {
      async recordFrame(frame, evidence) {
        const fits = await encodeCaptureFits(frame, run)
        const filename = `${evidence.phase}-${randomUUID()}.fits`
        await writeFile(join(directory, filename), fits)
        await append({ type: 'frame', original: { filename, bytes: fits.length, sha256: createHash('sha256').update(fits).digest('hex') }, capture: { width: frame.width, height: frame.height, capturedAt: frame.capturedAt, capturedAtSource: frame.capturedAtSource ?? 'camera', color: frame.color }, evidence })

        if (evidence.phase === 'adjusting') {
          if (adjustment) await unlink(join(directory, adjustment))
          adjustment = filename
        }
      },
      async recordMeasurement(sample, measurement, mount) { await append({ type: 'measurement', sample, measurement, tracking: true, mount }) },
      async finish(outcome) { await append({ type: 'outcome', ...outcome }) },
    }
  }
}
