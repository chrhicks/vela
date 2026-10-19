import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { jsonText, type ReadResult, type Skipped } from './inputs.ts'

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

const entry = z.discriminatedUnion('kind', [exchange, imageCheck])

export type JournalEntry = z.infer<typeof entry>

export type JournalExchange = z.infer<typeof exchange>

export type JournalImageCheck = z.infer<typeof imageCheck>

/**
 * Reads Vela's Cria journal (`cria-journal.jsonl`). A line of a kind this packager does not use is
 * passed over, one of a used kind that does not decode is skipped and listed. A torn last line is
 * one of those. The `origin` field, a host address, is never read.
 */
export async function readJournal(path: string): Promise<ReadResult<JournalEntry>> {
  const items: JournalEntry[] = []
  const skipped: Skipped[] = []
  const lines = (await readFile(path, 'utf8')).split('\n')

  lines.forEach((line, index) => {
    if (line.trim() === '') return

    const kind = jsonText(z.looseObject({ kind: z.string() })).safeParse(line)

    if (kind.success && !['exchange', 'image'].includes(kind.data.kind)) return

    const parsed = jsonText(entry).safeParse(line)

    if (parsed.success) items.push(parsed.data)
    else skipped.push({ where: `${path}:${index + 1}`, reason: z.prettifyError(parsed.error) })
  })

  return { items, skipped }
}
