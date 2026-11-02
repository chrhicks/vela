import { createReadStream } from 'node:fs'
import { mkdir, open, opendir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { decodeLine, kinds } from '@vela/rig-events'
import { brokerPosition, type ArchiveRecord } from '../run-log/archive.js'

const locationSchema = z.object({ sequence: z.number(), path: z.string(), offset: z.number(), length: z.number() })

export async function* recoverFacts(directory: string, stateDirectory: string, through: number): AsyncGenerator<ArchiveRecord> {
  await mkdir(stateDirectory, { recursive: true })
  const indexPath = join(stateDirectory, 'recovery.sqlite')

  await rm(indexPath, { force: true })
  const index = new DatabaseSync(indexPath)

  try {
    index.exec('PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-8192; PRAGMA mmap_size=0')
    index.exec('CREATE TABLE locations (sequence INTEGER PRIMARY KEY, path TEXT, offset INTEGER, length INTEGER)')
    const insert = index.prepare('INSERT OR IGNORE INTO locations VALUES (?, ?, ?, ?)')

    index.exec('BEGIN')

    for await (const day of await opendir(directory)) {
      if (!day.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(day.name)) continue
      const dayPath = join(directory, day.name)

      for await (const kind of await opendir(dayPath)) {
        if (!kind.isDirectory() || !Object.entries(kinds).some(([name, spec]) => name === kind.name && spec.branch === 'fact')) continue
        const kindPath = join(dayPath, kind.name)

        for await (const entry of await opendir(kindPath)) {
          if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
          const path = join(kindPath, entry.name)
          const input = createReadStream(path, { encoding: 'utf8' })
          const lines = createInterface({ input, crlfDelay: Infinity })
          let offset = 0

          try {
            for await (const line of lines) {
              const length = Buffer.byteLength(line)
              const { broker } = z.object({ broker: brokerPosition.optional() }).parse(JSON.parse(line))

              if (broker?.stream === 'RIG_FACTS' && broker.sequence <= through)
                insert.run(broker.sequence, path, offset, length)
              offset += length + 1
            }
          } finally {
            lines.close()
            input.destroy()
          }
        }
      }
    }

    index.exec('COMMIT')

    for (const row of index.prepare('SELECT * FROM locations ORDER BY sequence').iterate()) {
      const location = locationSchema.parse(row)
      const file = await open(location.path, 'r')
      const data = Buffer.alloc(location.length)

      try {
        const { bytesRead } = await file.read(data, 0, data.length, location.offset)

        if (bytesRead !== data.length) throw new Error('Truncated model recovery archive')
      } finally { await file.close() }

      const decoded = decodeLine(data.toString('utf8'))

      if (!decoded.ok) throw new Error('Invalid model recovery envelope')
      yield { ...decoded.event, broker: { stream: 'RIG_FACTS', sequence: location.sequence } }
    }
  } finally {
    index.close()
    await rm(indexPath, { force: true })
  }
}
