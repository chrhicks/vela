import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { jsonText, type ReadResult, type Skipped } from './inputs.ts'

const epochMs = z.number().transform(ms => new Date(ms))

const manifestFile = z.object({
  instanceId: z.string(),
  startedAt: epochMs,
  devices: z.array(z.object({ id: z.string(), kind: z.string(), indiDevice: z.string() })),
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
    value: z.looseObject({ image: z.looseObject({ id: z.string(), sha256: z.string().optional(), original: z.looseObject({ bytes: z.int() }).optional() }).nullish() }).optional(),
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
  /** The last line is not complete: Cria died in the middle of an append. */
  readonly tornTail: boolean
  /** The last line is `end`: Cria shut down cleanly. */
  readonly ended: boolean
}

/**
 * Reads a recording folder written by Cria's recorder (`manifest.json` and `traffic.jsonl`; `blobs/`
 * is never opened). A last line with no newline is a torn tail and is dropped. A line that ends with
 * a newline but does not decode is damage: the lines before it are kept, everything after is ignored
 * and the damage is listed, because a reader that skips it would join across a hole.
 */
export async function readRecording(directory: string): Promise<Recording> {
  const manifest = manifestFile.parse(JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')))
  const text = await readFile(join(directory, 'traffic.jsonl'), 'utf8')
  const lines = text.split('\n')
  const tornTail = lines.pop() !== ''
  const items: RecordedLine[] = []
  const skipped: Skipped[] = []

  for (const [index, line] of lines.entries()) {
    const parsed = jsonText(trafficLine).safeParse(line)

    if (!parsed.success) {
      skipped.push({ where: `${directory}/traffic.jsonl:${index + 1}`, reason: `damaged; this line and the ${lines.length - index - 1} after it are ignored` })
      break
    }

    items.push(parsed.data)
  }

  return {
    items,
    skipped,
    name: directory.split('/').filter(Boolean).pop() ?? directory,
    instanceId: manifest.instanceId,
    startedAt: manifest.startedAt,
    devices: manifest.devices,
    tornTail,
    ended: items.at(-1)?.k === 'end',
  }
}

export function operationsOf(recording: Recording): readonly RecordedOperation[] {
  return recording.items.flatMap(line => (line.k === 'op' ? [line.operation] : []))
}
