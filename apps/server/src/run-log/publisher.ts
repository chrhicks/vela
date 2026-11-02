import { readFile } from 'node:fs/promises'
import { connect, type NatsConnection } from '@nats-io/transport-node'
import { jetstream } from '@nats-io/jetstream'
import { encodeEvent, epochMs, seal, sourceId, subjectOf, type RigEvent } from '@vela/rig-events'
import { z } from 'zod'

// 128 x 40 KiB snapshots = 5 MiB, about two minutes at one snapshot/second.
// Smaller events hit the count cap first. One in-flight message adds at most 1 MiB.
export const publisherLimits = { count: 128, bytes: 5 * 1024 ** 2, messageBytes: 1024 ** 2 }

type Entry = { event: Pick<RigEvent, 'id' | 'rig' | 'kind' | 'seenAt'>; data: Uint8Array }

type Loss = { rig: RigEvent['rig']; from: number; to: number; count: number }

export interface PublisherOptions {
  readonly url: string
  readonly credentialsFile: string
  readonly limits?: typeof publisherLimits
}

export function openPublisher({ url, credentialsFile, limits = publisherLimits }: PublisherOptions) {
  const queue: Entry[] = []
  const losses = new Map<RigEvent['rig'], Loss>()
  let bytes = 0
  let dropped = 0
  let closed = false
  let connection: NatsConnection | undefined
  let lastError: string | null = null
  let timer: NodeJS.Timeout | undefined
  let gap: RigEvent | undefined
  const credentials = readFile(credentialsFile, 'utf8').then(text => z.object({ publisher: z.string().min(1) }).parse(JSON.parse(text)))

  void credentials.catch(() => { lastError = 'Could not read publisher credentials' })

  function lose(event: Pick<RigEvent, 'rig' | 'seenAt'>) {
    const loss = losses.get(event.rig)
    const at = event.seenAt

    dropped += 1

    if (loss) {
      loss.count += 1
      loss.from = Math.min(loss.from, at)
      loss.to = Math.max(loss.to, at)
    } else losses.set(event.rig, { rig: event.rig, from: at, to: at, count: 1 })
  }

  function trim() {
    while (queue.length > limits.count || bytes > limits.bytes) {
      const oldest = queue.shift()

      if (!oldest) break
      bytes -= oldest.data.byteLength
      lose(oldest.event)
    }
  }

  function schedule(delay: number) {
    if (closed) return
    timer = setTimeout(() => { void drain() }, delay)
    timer.unref()
  }

  async function drain() {
    try {
      if (!connection || connection.isClosed()) {
        const { publisher } = await credentials

        if (closed) return
        connection = await connect({ servers: url, user: 'publisher', pass: publisher,
          inboxPrefix: '_INBOX.publisher', reconnect: false, timeout: 500 })

        if (closed) return void connection.close()
      }

      const client = jetstream(connection, { timeout: 500 })

      while (!closed) {
        if (!gap) {
          const loss = losses.values().next().value

          if (loss) {
            losses.delete(loss.rig)
            const source = sourceId(`vela:nats:${loss.rig}`)
            gap = seal({ kind: 'gap', rig: loss.rig, source, at: epochMs(loss.from), seenAt: epochMs(Date.now()),
              body: { source, from: epochMs(loss.from), to: epochMs(loss.to), reason: 'dropped', dropped: loss.count } })
          }
        }

        const entry = gap ? undefined : queue.shift()
        const current = gap ? { event: gap, data: Buffer.from(encodeEvent(gap)) } : entry

        if (!current) break
        const { event, data } = current

        if (!gap) bytes -= data.byteLength

        try {
          await client.publish(subjectOf(event.rig, event.kind), data, { msgID: event.id, retries: 1 })
        } catch (error) {
          if (entry) {
            queue.unshift(entry)
            bytes += entry.data.byteLength
            trim()
          }

          throw error
        }

        lastError = null
        gap = undefined
      }
    } catch {
      lastError = 'NATS publish unavailable; retrying'
      await connection?.close()
      connection = undefined
    } finally {
      schedule(500)
    }
  }

  schedule(0)

  return {
    append(event: RigEvent): void {
      if (closed) return
      const data = Buffer.from(encodeEvent(event))

      if (data.byteLength > Math.min(limits.bytes, limits.messageBytes)) return lose(event)

      queue.push({ event: { id: event.id, rig: event.rig, kind: event.kind, seenAt: event.seenAt }, data })
      bytes += data.byteLength
      trim()
    },
    health: () => ({ connected: !!connection && !connection.isClosed(), queued: queue.length, queuedBytes: bytes, dropped, lastError }),
    async close() {
      closed = true
      clearTimeout(timer)
      await connection?.close()
    },
  }
}

export type Publisher = ReturnType<typeof openPublisher>
