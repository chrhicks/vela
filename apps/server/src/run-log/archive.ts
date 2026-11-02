import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, readdir, rename } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { z } from 'zod'
import { createArchiveReader, encodeEvent, kinds, type ArchiveRange, type RigEvent } from '@vela/rig-events'

async function syncDirectory(directory: string) {
  const handle = await open(directory, 'r')

  try { await handle.sync() } finally { await handle.close() }
}

async function syncArchiveAncestors(directory: string): Promise<void> {
  const parent = dirname(directory)

  if (parent === directory) return
  await syncArchiveAncestors(parent)

  try {
    await mkdir(directory)
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
  }

  await syncDirectory(parent)
}

export const brokerPosition = z.object({ stream: z.string().min(1), sequence: z.number().int().positive() })

export type ArchiveRecord = RigEvent & { readonly broker?: z.infer<typeof brokerPosition> }

export async function writeArchiveBatch(directory: string, events: readonly ArchiveRecord[]) {
  const groups = new Map<string, string[]>()

  for (const event of events) {
    const day = new Date(event.at).toISOString().slice(0, 10)
    const path = join(resolve(directory), day, event.kind)
    const lines = groups.get(path) ?? []

    lines.push(encodeEvent(event) + '\n')
    groups.set(path, lines)
  }

  for (const [path, lines] of groups) {
    await syncArchiveAncestors(path)
    const name = join(path, randomUUID())
    const file = await open(name + '.tmp', 'wx', 0o600)

    try {
      await file.writeFile(lines.join(''))
      await file.sync()
    } finally { await file.close() }

    await rename(name + '.tmp', name + '.jsonl')
    await syncDirectory(path)
  }
}

/** Broker records replay in stream sequence order. Legacy records retain file order. */
export async function* readArchive(directory: string, range: ArchiveRange): AsyncGenerator<ArchiveRecord> {
  const reader = createArchiveReader(range)
  const records: ArchiveRecord[] = []
  const fromDay = new Date(range.from).toISOString().slice(0, 10)
  const toDay = new Date(range.to).toISOString().slice(0, 10)
  const days = (await readdir(directory)).filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= fromDay && day <= toDay).sort()

  for (const day of days) {
    const dayPath = join(directory, day)
    const present = await readdir(dayPath)

    for (const kind of range.kinds ?? Object.keys(kinds)) {
      if (!present.includes(kind)) continue
      const path = join(dayPath, kind)
      const files = (await readdir(path)).filter(file => file.endsWith('.jsonl')).sort()

      for (const file of files) {
        const input = createReadStream(join(path, file), { encoding: 'utf8' })
        const lines = createInterface({ input, crlfDelay: Infinity })

        try {
          for await (const line of lines) {
            const event = reader.read(line)

            if (event) {
              const metadata = z.object({ broker: brokerPosition.optional() }).parse(JSON.parse(line))

              records.push(metadata.broker ? { ...event, broker: metadata.broker } : event)
            }
          }
        } finally {
          lines.close()
          input.destroy()
        }
      }
    }
  }

  const ordered = records.filter(record => record.broker).sort((a, b) =>
    a.broker!.stream.localeCompare(b.broker!.stream) || a.broker!.sequence - b.broker!.sequence)

  let index = 0

  for (const record of records) yield record.broker ? ordered[index++]! : record
}
