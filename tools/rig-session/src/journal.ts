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

/**
 * Reads Vela's Cria journal (`cria-journal.jsonl`) as a stream, so a journal larger than memory builds in
 * constant space, and keeps only the entries a table needs: those of a used kind that start in the
 * window. A line of a kind this packager does not use is passed over, one of a used kind that does not
 * decode is skipped and listed. A torn last line is one of those. The `origin` field, a host address, is
 * never exported; it is learned, so it is removed wherever it occurs.
 */
export async function readJournal(path: string, { inWindow = () => true, secrets = new Secrets() }: JournalReadOptions = {}): Promise<ReadResult<JournalEntry>> {
  const items: JournalEntry[] = []
  const skipped: Skipped[] = []
  let notListed = 0

  const skip = (where: string, reason: string) => {
    if (skipped.length < maxSkippedListed) skipped.push({ where, reason })
    else notListed += 1
  }

  for await (const raw of linesOf(path)) {
    if (raw.text.trim() === '' && !raw.tooLong) continue

    const where = `${path}:${raw.number}`

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

    const kind = z.looseObject({ kind: z.string() }).safeParse(json.data)

    if (kind.success && !entryKinds.has(kind.data.kind)) continue

    const parsed = entry.safeParse(json.data)

    if (!parsed.success) skip(where, z.prettifyError(parsed.error))
    else {
      if (parsed.data.kind === 'state') learnFromReadings(parsed.data.changed, secrets)

      if (inWindow(parsed.data.at)) items.push(parsed.data)
    }
  }

  if (notListed > 0) skipped.push({ where: path, reason: `${notListed} more lines did not decode and are not listed` })

  return { items, skipped }
}
