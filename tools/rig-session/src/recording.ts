import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { IndiEventTracker, type IndiEvent } from './indi.ts'
import { jsonText, linesOf, type ReadResult, type Skipped } from './inputs.ts'
import { Secrets } from './sanitize.ts'
import { learnFromMessage } from './traffic-secrets.ts'

const epochMs = z.number().transform(ms => new Date(ms))

const manifestFile = z.object({
  instanceId: z.string(),
  startedAt: epochMs,
  devices: z.array(z.object({ id: z.string(), kind: z.string(), indiDevice: z.string() })),
  indi: z.object({ host: z.string() }).optional(),
})

const operation = z.looseObject({
  id: z.string(),
  requestId: z.string(),
  instanceId: z.string(),
  deviceId: z.string(),
  kind: z.string(),
  parameters: z.json().optional(),
  acceptedAt: epochMs,
  startedAt: epochMs.nullish(),
  settledAt: epochMs,
  outcome: z.looseObject({
    kind: z.string(),
    reason: z.string().optional(),
    message: z.string().optional(),
    value: z.looseObject({ image: z.looseObject({ id: z.string(), original: z.looseObject({ bytes: z.int() }).optional() }).nullish() }).optional(),
  }),
})

const trafficLine = z.discriminatedUnion('k', [
  z.object({ k: z.literal('msg'), at: epochMs, conn: z.int(), dir: z.enum(['in', 'out']), n: z.int(), xml: z.string(), blobs: z.array(z.string()).optional() }),
  z.object({ k: z.literal('op'), at: epochMs, operation }),
  z.object({ k: z.literal('conn'), at: epochMs, conn: z.int(), status: z.enum(['connected', 'closed']) }),
  z.object({ k: z.literal('gap'), at: epochMs, reason: z.string() }),
  z.object({ k: z.literal('end'), at: epochMs }),
])

export type RecordedLine = z.infer<typeof trafficLine>

export type RecordedOperation = Extract<RecordedLine, { k: 'op' }>['operation']

export interface RecordedDevice {
  /** Cria's id for the device (`primary`, `mount`), the one operations name. */
  readonly id: string
  readonly kind: string
  /** The device's name on the INDI wire. */
  readonly indiDevice: string
}

export interface Recording extends ReadResult<RecordedLine> {
  readonly name: string
  readonly instanceId: string
  readonly startedAt: Date
  readonly devices: readonly RecordedDevice[]
  /** The changes on the INDI wire, in order (`indi_events` before its window). */
  readonly events: readonly IndiEvent[]
  /** Lines that decoded; `items` holds only the ones a table needs (see `readRecording`). */
  readonly linesRead: number
  /** The last line is not complete: Cria died in the middle of an append. */
  readonly tornTail: boolean
  /** The last line is `end`: Cria shut down cleanly. */
  readonly ended: boolean
}

/** The lines the tables are built from; the others are used as they stream by and not kept. */
const kept = (line: RecordedLine) => line.k === 'op' || line.k === 'gap' || line.k === 'end'

/**
 * Reads a recording folder written by Cria's recorder (`manifest.json` and `traffic.jsonl`; `blobs/`
 * is never opened). A tape can be far larger than memory, so it is streamed and a line is kept only if
 * a table needs it: `items` holds the operation, gap and end lines. A last line with no newline is a
 * torn tail and is dropped. A line that ends with a newline but does not decode is damage: the lines
 * before it are kept, everything after is ignored and the damage is listed, because a reader that skips
 * it would join across a hole. What the traffic says that a package must not hold (the site, ports, serial
 * numbers) is learned into `secrets` as the lines pass.
 */
export async function readRecording(directory: string, secrets = new Secrets()): Promise<Recording> {
  const manifest = manifestFile.parse(JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')))

  if (manifest.indi && !['localhost', '127.0.0.1', '::1'].includes(manifest.indi.host)) secrets.addLiteral(manifest.indi.host)

  const path = join(directory, 'traffic.jsonl')
  const items: RecordedLine[] = []
  const events = new IndiEventTracker()
  let damagedAt: number | null = null
  let linesRead = 0
  let ignored = 0
  let tornTail = false
  let last: RecordedLine | undefined

  for await (const raw of linesOf(path)) {
    if (!raw.complete) {
      tornTail = true

      break
    }

    if (damagedAt !== null) {
      ignored += 1

      continue
    }

    const parsed = raw.tooLong ? null : jsonText(trafficLine).safeParse(raw.text)

    if (parsed?.success) {
      linesRead += 1
      last = parsed.data

      events.accept(parsed.data)

      if (parsed.data.k === 'msg') learnFromMessage(parsed.data.xml, secrets)
      else if (parsed.data.k === 'op') secrets.learnFromJson(jsonText(z.json()).parse(raw.text))

      if (kept(parsed.data)) items.push(parsed.data)
    } else damagedAt = raw.number
  }

  const skipped: Skipped[] = damagedAt === null ? [] : [{ where: `${path}:${damagedAt}`, reason: `damaged; this line and the ${ignored} after it are ignored` }]

  return {
    items,
    skipped,
    name: directory.split('/').filter(Boolean).pop() ?? directory,
    instanceId: manifest.instanceId,
    startedAt: manifest.startedAt,
    devices: manifest.devices,
    events: events.events,
    linesRead,
    tornTail,
    ended: last?.k === 'end',
  }
}

export function operationsOf(recording: Recording): readonly RecordedOperation[] {
  return recording.items.flatMap(line => (line.k === 'op' ? [line.operation] : []))
}
