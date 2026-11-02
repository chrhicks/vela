import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { jsonText, linesOf, type ReadResult, type Skipped } from './inputs.ts'
import { Secrets, type Json } from './sanitize.ts'

const epochMs = z.number().transform(ms => new Date(ms))

const exchange = z.object({
  kind: z.literal('exchange'),
  at: epochMs,
  ms: z.number(),
  method: z.enum(['GET', 'POST']),
  route: z.string(),
  status: z.int().nullable(),
  command: z.object({ requestId: z.string(), deviceId: z.string(), kind: z.string(), parameters: z.json().optional() }).nullable(),
  reply: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('answered'), body: z.json().optional() }),
    z.object({ kind: z.literal('refused'), code: z.string(), message: z.string() }),
    z.object({ kind: z.literal('lost'), message: z.string() }),
  ]),
})

const imageCheck = z.object({
  kind: z.literal('image'),
  at: epochMs,
  imageId: z.string(),
  operationId: z.string(),
  bytes: z.int(),
  sha256: z.string(),
  verdict: z.enum(['intact', 'damaged', 'gone', 'failed']),
})

const stateChange = z.object({
  kind: z.literal('state'),
  at: epochMs,
  generatedAt: epochMs,
  sequence: z.int(),
  instanceId: z.string(),
  baseline: z.boolean(),
  changed: z.record(z.string(), z.json()),
  removed: z.array(z.string()),
})

const stream = z.object({ kind: z.literal('stream'), at: epochMs, event: z.enum(['opened', 'ended']), message: z.string().nullable() })

const entry = z.discriminatedUnion('kind', [exchange, imageCheck, stateChange, stream])

export type JournalEntry = z.infer<typeof entry>

export type JournalExchange = z.infer<typeof exchange>

export type JournalImageCheck = z.infer<typeof imageCheck>

export type JournalStateChange = z.infer<typeof stateChange>

export type JournalStream = z.infer<typeof stream>

/** Lines that fail to decode are listed, but not without end: a journal of garbage must not fill the heap. */
const maxSkippedListed = 1000

export interface JournalReadOptions {
  /** Only entries that start inside it are kept; a journal spans many nights and only one is packaged. */
  readonly inWindow?: (time: Date) => boolean
  /** Learns the journal's `origin`, a host address, so that it is removed from every cell. */
  readonly secrets?: Secrets
}

/** A mount reports the site as readings; learn them so they are removed wherever they occur, even from a cell nobody lists. */
function learnFromReadings(changed: Readonly<Record<string, Json>>, secrets: Secrets): void {
  for (const [cell, reading] of Object.entries(changed)) {
    const kind = /readings\.(latitude|longitude|elevation)/.exec(cell)?.[1]
    const value = z.looseObject({ value: z.number() }).safeParse(reading)

    if (value.success && (kind === 'latitude' || kind === 'longitude' || kind === 'elevation')) secrets.addCoordinate(kind, value.data.value)
  }
}

const entryKinds = new Set<string>(['exchange', 'image', 'state', 'stream'])

/** The run log (`docs/run-log.md`) names its kinds `cria.<kind>`; its body is the old entry without `kind` and `at`. */
const runLogKinds = new Map([
  ['cria.exchange', 'exchange'],
  ['cria.image', 'image'],
  ['cria.stream', 'stream'],
])

const runLogLine = z.looseObject({ v: z.number() })

const runLogEnvelope = z.object({ kind: z.string(), seenAt: z.number(), body: z.record(z.string(), z.json()) })

const runLogState = z.object({
  origin: z.string(),
  state: z.object({
    generatedAt: z.number(),
    sequence: z.int(),
    instanceId: z.string(),
    devices: z.array(z.object({ id: z.string(), readings: z.record(z.string(), z.json()) }).catchall(z.json())),
    operations: z.array(z.object({ id: z.string() }).catchall(z.json())),
  }),
})

type Cells = Map<string, { readonly compared: string; readonly cell: Json }>

const withoutObservedAt = (key: string, value: Json) => (key === 'observedAt' ? undefined : value)

/** A snapshot as the cells the old journal kept: `device/<id>/readings.<field>`, `device/<id>/<field>` and `operation/<id>`. */
function cellsOf(state: z.infer<typeof runLogState>['state']): Cells {
  const cells: Cells = new Map()

  const add = (key: string, cell: Json) => cells.set(key, { compared: JSON.stringify(cell, withoutObservedAt), cell })

  for (const device of state.devices) {
    const { readings, ...rest } = device

    for (const [field, reading] of Object.entries(readings)) add(`device/${device.id}/readings.${field}`, reading)

    for (const [field, value] of Object.entries(rest)) add(`device/${device.id}/${field}`, value)
  }

  for (const operation of state.operations) add(`operation/${operation.id}`, operation)

  return cells
}

/** What the old journal wrote for a snapshot: only the cells that differ from the last one of its origin. A new `observedAt` alone is not a difference. */
function changes(previous: Cells | undefined, current: Cells) {
  return {
    baseline: previous === undefined,
    changed: Object.fromEntries([...current].flatMap(([key, { compared, cell }]) => (previous?.get(key)?.compared === compared ? [] : [[key, cell]]))),
    removed: previous === undefined ? [] : [...previous.keys()].filter(key => !current.has(key)),
  }
}

type Decoded = { readonly kind: 'entry'; readonly entry: JournalEntry } | { readonly kind: 'unused' } | { readonly kind: 'bad'; readonly reason: string }

function decoded(result: ReturnType<typeof entry.safeParse>): Decoded {
  return result.success ? { kind: 'entry', entry: result.data } : { kind: 'bad', reason: z.prettifyError(result.error) }
}

/** One line of the old journal: a line of a kind the packager does not use is passed over. */
function decodeJournalLine(json: Json): Decoded {
  const kind = z.looseObject({ kind: z.string() }).safeParse(json)

  return kind.success && !entryKinds.has(kind.data.kind) ? { kind: 'unused' } : decoded(entry.safeParse(json))
}

/** One run-log line as the entry the old journal would have held, stamped with when Vela saw it. `snapshots` holds the last cells of each origin. */
function decodeRunLogLine(json: Json, snapshots: Map<string, Cells>): Decoded {
  const line = runLogEnvelope.safeParse(json)

  if (!line.success) return { kind: 'bad', reason: z.prettifyError(line.error) }

  const { kind, seenAt, body } = line.data

  if (kind === 'cria.state') {
    const snapshot = runLogState.safeParse(body)

    if (!snapshot.success) return { kind: 'bad', reason: z.prettifyError(snapshot.error) }

    const { origin, state } = snapshot.data
    const current = cellsOf(state)
    const result = decoded(entry.safeParse({ kind: 'state', at: seenAt, generatedAt: state.generatedAt, sequence: state.sequence, instanceId: state.instanceId, ...changes(snapshots.get(origin), current) }))

    snapshots.set(origin, current)

    return result
  }

  const entryKind = runLogKinds.get(kind)

  return entryKind === undefined ? { kind: 'unused' } : decoded(entry.safeParse({ ...body, kind: entryKind, at: seenAt }))
}

/** The files to read: a directory is a run log, its `run-*.jsonl` files in time order; any other path is one file, a run-log file or an old journal. */
export async function journalFiles(path: string): Promise<string[]> {
  if (!(await stat(path)).isDirectory()) return [path]

  return (await readdir(path)).filter(name => /^run-.+\.jsonl$/.test(name)).sort().map(name => join(path, name))
}

/**
 * Reads what Vela's Cria client saw, from a run-log directory (`docs/run-log.md`), a run-log file or an old
 * journal file (`cria-journal.jsonl`); each line says which it is. It streams, so a log larger than memory
 * builds in constant space, and keeps only the entries a table needs: those of a used kind that start in the
 * window. A line of a kind this packager does not use is passed over, one of a used kind that does not
 * decode is skipped and listed. A torn last line is one of those. The `origin` field, a host address, is
 * never exported; it is learned, so it is removed wherever it occurs. A run log keeps whole snapshots, so
 * they are cut down to the changed cells here, as the old journal wrote them; the first snapshot of each
 * origin in each file is a baseline.
 */
export async function readJournal(path: string, { inWindow = () => true, secrets = new Secrets() }: JournalReadOptions = {}): Promise<ReadResult<JournalEntry>> {
  const items: JournalEntry[] = []
  const skipped: Skipped[] = []
  let notListed = 0

  const skip = (where: string, reason: string) => {
    if (skipped.length < maxSkippedListed) skipped.push({ where, reason })
    else notListed += 1
  }

  for (const file of await journalFiles(path)) {
    const snapshots = new Map<string, Cells>()

    for await (const raw of linesOf(file)) {
      if (raw.text.trim() === '' && !raw.tooLong) continue

      const where = `${file}:${raw.number}`

      if (raw.tooLong) {
        skip(where, 'line too long')

        continue
      }

      const origin = /"origin"\s*:\s*"([^"\\]*)"/.exec(raw.text)?.[1]

      if (origin !== undefined) secrets.learnAddress(origin)

      const json = jsonText(z.json()).safeParse(raw.text)

      if (!json.success) {
        skip(where, 'not JSON')

        continue
      }

      const line = runLogLine.safeParse(json.data).success ? decodeRunLogLine(json.data, snapshots) : decodeJournalLine(json.data)

      if (line.kind === 'bad') skip(where, line.reason)
      else if (line.kind === 'entry') {
        if (line.entry.kind === 'state') learnFromReadings(line.entry.changed, secrets)

        if (inWindow(line.entry.at)) items.push(line.entry)
      }
    }
  }

  if (notListed > 0) skipped.push({ where: path, reason: `${notListed} more lines did not decode and are not listed` })

  return { items, skipped }
}
