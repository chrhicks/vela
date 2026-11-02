import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { decodeLine, mountSite, type Envelope } from '@vela/rig-events'
import { localSiderealDegrees, type Site } from '@vela/rig-sky'
import { diagnosticEntrySchema, readEntry, type DiagnosticEntry } from './diagnostic-schema.js'

type AlignmentEvent = Envelope<'alignment'>

type Simulator = Extract<AlignmentEvent['body'], { mode: 'offline' }>['simulator']

/** The offline simulator's sidereal time at `capturedAt`: its time at `simulator.at`, advancing at the sidereal rate. */
export function simulatorSiderealDegrees(simulator: Pick<Simulator, 'siderealTimeDegrees' | 'at'>, capturedAt: string): number {
  return (simulator.siderealTimeDegrees + (((Date.parse(capturedAt) - Date.parse(simulator.at)) / 1000) * 360) / 86164.0905 + 360) % 360
}

/**
 * The entries of one trial's `alignment` events, in the shape of the journal lines they replace. The events name no site,
 * so a physical trial gets its site from the first mount snapshot of its rig in the log file that holds its `run`
 * event, and an offline trial gets its latitude and sidereal time from the simulator its `run` event names. Every
 * sample's sidereal time is computed again from that site and the sample's time.
 */
export function journalEntriesOf(events: readonly AlignmentEvent[], site: Site | null): DiagnosticEntry[] {
  const first = events[0]

  if (first?.body.type !== 'run') throw new Error('Alignment diagnostic events are missing run metadata')

  const { body: run } = first
  const simulator = run.mode === 'offline' ? run.simulator : undefined

  if (!simulator && !site) throw new Error('Alignment diagnostic run has no mount site in the run log')

  const sidereal = (capturedAt: string) => (simulator ? simulatorSiderealDegrees(simulator, capturedAt) : localSiderealDegrees(new Date(capturedAt), site!))

  const latitudeDegrees = simulator ? simulator.latitudeDegrees : site!.latitudeDegrees

  const sampleOf = <S extends { capturedAt: string }>(sample: S) => ({ ...sample, siderealTimeDegrees: sidereal(sample.capturedAt) })

  const entryOf = ({ body, at, rig }: AlignmentEvent) => {
    switch (body.type) {
      case 'run': {
        const { runId, rigName, mode, cameraId, telescopeId, cameraName, exposureSeconds } = body

        return { type: 'run', schemaVersion: 1, createdAt: new Date(at).toISOString(), run: { runId, rigId: rig, rigName, mode, cameraId, telescopeId, cameraName, exposureSeconds } }
      }

      case 'frame': {
        const { original, capture, evidence } = body
        const { physical, ...rest } = evidence

        return {
          type: 'frame',
          original,
          capture,
          evidence: { ...rest, solution: { status: 'solved', ...evidence.solution }, sample: sampleOf(evidence.sample), ...(physical && { physical: { site: site!, ...physical } }) },
        }
      }

      case 'fit':
        return { type: 'fit', latitudeDegrees, fixes: body.fixes.map(fix => ({ position: fix.position, sample: sampleOf(fix.sample) })), polar: body.polar, verdict: body.verdict }
      case 'measurement':
        return { ...body, sample: sampleOf(body.sample) }
      case 'dropped':
      case 'outcome':
        return body
    }
  }

  return events.map((event, index) => readEntry(index, () => diagnosticEntrySchema.parse(entryOf(event))))
}

async function logFiles(runLog: string): Promise<string[]> {
  if (!(await stat(runLog)).isDirectory()) return [runLog]

  return (await readdir(runLog)).filter(name => /^run-.+\.jsonl$/.test(name)).sort().map(name => join(runLog, name))
}

/**
 * Reads the run log (a directory of `run-*.jsonl` files or one file) for the trial in `folder`, and returns its entries as
 * `journalEntriesOf` makes them, or undefined when the log holds no run for that folder.
 */
export async function loggedJournalEntries(runLog: string, folder: string): Promise<DiagnosticEntry[] | undefined> {
  const byRun = new Map<string, Map<number, AlignmentEvent>>()
  let runId: string | undefined
  let site: Site | null = null

  for (const file of await logFiles(runLog)) {
    const firstSites = new Map<string, Site>()
    let runRig: string | undefined

    async function* committedLines() {
      let pending = ''

      for await (const chunk of createReadStream(file, { encoding: 'utf8' })) {
        const lines = (pending + chunk).split('\n')
        pending = lines.pop()!
        yield* lines
      }
    }

    for await (const text of committedLines()) {
      if (!text.includes('"kind":"alignment"') && !text.includes('"kind":"cria.state"')) continue

      const decoded = decodeLine(text)

      if (!decoded.ok) continue

      const { event } = decoded

      if (event.kind === 'alignment') {
        const events = byRun.get(event.body.runId) ?? new Map<number, AlignmentEvent>()

        byRun.set(event.body.runId, events)
        events.set(event.body.n, event)

        if (event.body.type === 'run' && event.body.folder === folder) {
          runId = event.body.runId
          runRig = event.rig
        }
      } else if (event.kind === 'cria.state' && !firstSites.has(event.rig)) {
        const mount = mountSite(event.body.state)

        if (mount) firstSites.set(event.rig, mount)
      }
    }

    if (runRig !== undefined) site ??= firstSites.get(runRig) ?? null
  }

  if (runId === undefined) return undefined

  return journalEntriesOf([...byRun.get(runId)!.values()].sort((a, b) => a.body.n - b.body.n), site)
}
