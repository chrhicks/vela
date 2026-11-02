import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { decodeEvent, encodeEvent, epochMs, rigId, seal, sourceId, type Envelope, type RigEvent, type State } from '@vela/rig-events'
import type { Site } from '@vela/rig-sky'
import { diagnosticEntrySchema, diagnosticJournalName, type DiagnosticEntry } from './diagnostic-schema.js'
import { replayAlignmentDiagnostics } from './diagnostic-replay.js'

interface TrialOf {
  directory: string
}

interface ReadTrials {
  readTrials(root: string, runLog?: string): Promise<{ problems: unknown[]; trials: TrialOf[] }>
}

interface MountStates {
  mountState(options: { sequence: number; mount: { at: number; raHours: number; decDegrees: number; site: Required<Site> } }): State
}

// The server's type-checked build cannot compile the source of `rig-frames` or `rig-testing`, so both load at run time.
// SAFETY: the module is `rig-frames`' index, whose `readTrials` has the shape declared above.
const { readTrials } = (await import(new URL('../../../../packages/rig-frames/src/index.ts', import.meta.url).href)) as ReadTrials

// SAFETY: the module is `rig-testing`' index, whose `mountState` has the shape declared above.
const { mountState } = (await import(new URL('../../../../packages/rig-testing/src/index.ts', import.meta.url).href)) as MountStates

type Simulator = Extract<Envelope<'alignment'>['body'], { mode: 'offline' }>['simulator']

function bodyOf(entry: DiagnosticEntry, part: { runId: string; n: number }, folder: string, simulator: Simulator | undefined) {
  if (entry.type === 'baseline') throw new Error('A three-point baseline has no event')

  const body = entry.type === 'run' ? { ...entry.run, type: 'run', ...part, folder, ...(simulator && { simulator }) } : { ...entry, ...part }
  const decoded = decodeEvent({ v: 1, id: 'placeholder', rig: 'placeholder', kind: 'alignment', at: 0, seenAt: 0, source: 'placeholder', body })

  if (!decoded.ok || decoded.event.kind !== 'alignment') throw new Error('The entry does not make an alignment event')

  return decoded.event.body
}

async function moveJournalToRunLog(journalDirectory: string, destination: string, source: { site: Site } | { simulator: Simulator }) {
  const folder = basename(journalDirectory)
  const simulator = 'simulator' in source ? source.simulator : undefined
  const entries = (await readFile(join(journalDirectory, diagnosticJournalName), 'utf8')).trimEnd().split('\n').map(line => diagnosticEntrySchema.parse(JSON.parse(line)))
  const [first] = entries

  if (first?.type !== 'run') throw new Error('A journal starts with its run')

  const rig = rigId(first.run.rigId)
  const runAt = Date.parse(first.createdAt)
  const stamp = (at: number) => ({ rig, source: sourceId('vela:alignment'), at: epochMs(at), seenAt: epochMs(at) })

  const events: RigEvent[] = entries.map((entry, index) =>
    seal({ ...stamp(runAt + index), kind: 'alignment', body: bodyOf(entry, { runId: first.run.runId, n: index + 1 }, folder, simulator) }),
  )

  if ('site' in source)
    events.unshift(
      seal({
        ...stamp(runAt - 1000),
        source: sourceId('vela:cria'),
        kind: 'cria.state',
        body: { origin: 'http://cria.test', freshness: 'qualified', state: mountState({ sequence: 1, mount: { at: runAt - 1000, raHours: 0, decDegrees: 0, site: { elevationMeters: 0, ...source.site } } }) },
      }),
    )

  const runLog = join(destination, 'run-log')
  const trials = join(destination, 'trials')

  await mkdir(runLog, { recursive: true })
  await mkdir(join(trials, folder), { recursive: true })
  await writeFile(join(runLog, 'run-20261101T000000000Z-00001.jsonl'), events.map(event => `${encodeEvent(event)}\n`).join(''))

  for (const name of await readdir(journalDirectory)) if (name !== diagnosticJournalName) await copyFile(join(journalDirectory, name), join(trials, folder, name))

  return { runLog, trials, directory: join(trials, folder) }
}

/** What replay and `readTrials` say about a trial, read from its journal and then from the same trial as `alignment` events. */
export async function readBothWays(journalDirectory: string, source: { site: Site } | { simulator: Simulator }) {
  const destination = await mkdtemp(join(tmpdir(), 'vela-alignment-events-'))
  const { runLog, trials, directory } = await moveJournalToRunLog(journalDirectory, destination, source)

  const result = async (root: string, replayed: string, log?: string) => {
    const { trials: found, problems } = await readTrials(root, log)

    return { report: await replayAlignmentDiagnostics(replayed, log), trials: found.map(trial => ({ ...trial, directory: basename(trial.directory) })), problems }
  }

  try {
    return { journal: await result(dirname(journalDirectory), journalDirectory), events: await result(trials, directory, runLog) }
  } finally {
    await rm(destination, { recursive: true, force: true })
  }
}
