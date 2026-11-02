import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { loggedJournalEntries } from '../../apps/server/dist/alignment/alignment-events.js'
import { diagnosticEntrySchema, readEntry, type DiagnosticEntry } from '../../apps/server/dist/alignment/diagnostic-schema.js'

/** The entries of a recorded alignment trial, in the shape of its journal lines: its `journal.jsonl`, or the run log `alignment` events that name its folder. */
export async function trialEntries(directory: string, runLog: string): Promise<readonly DiagnosticEntry[]> {
  const journal = join(directory, 'journal.jsonl')

  if (existsSync(journal))
    return readFileSync(journal, 'utf8')
      .split('\n')
      .slice(0, -1)
      .filter(line => line.trim() !== '')
      .map((line, index) => readEntry(index, () => diagnosticEntrySchema.parse(JSON.parse(line))))

  return (existsSync(runLog) ? await loggedJournalEntries(runLog, basename(directory)) : undefined) ?? []
}
