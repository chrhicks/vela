import { writeFile, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { loggedJournalEntries } from './alignment-events.js'
import { diagnosticJournalName } from './diagnostic-schema.js'
import { replayAlignmentDiagnostics } from './diagnostic-replay.js'

interface Trials {
  readTrials(root: string, log?: string): Promise<{ trials: object[]; problems: object[] }>
}

// SAFETY: this test-only dynamic import is rig-frames' index; the server build cannot compile that package's source.
const { readTrials } = (await import(new URL('../../../../packages/rig-frames/src/index.ts', import.meta.url).href)) as Trials

/** Materializes the old journal shape solely to compare both readers of the real writer's output. */
export async function readBothFormats(directory: string, log: string) {
  const result = async (runLog?: string) => ({
    report: await replayAlignmentDiagnostics(directory, runLog),
    ...await readTrials(dirname(directory), runLog),
  })

  const events = await result(log)
  const entries = await loggedJournalEntries(log, basename(directory))
  const journal = join(directory, diagnosticJournalName)
  await writeFile(journal, entries!.map(entry => JSON.stringify(entry)).join('\n') + '\n')

  try {
    return { events, journal: await result() }
  } finally {
    await unlink(journal)
  }
}
