import { readFile } from 'node:fs/promises'
import { connect } from '@nats-io/transport-node'
import { jetstream, type JsMsg } from '@nats-io/jetstream'
import { decodeLine } from '@vela/rig-events'
import { z } from 'zod'
import { writeArchiveBatch } from './archive.js'

export interface ArchiverOptions {
  readonly url: string
  readonly credentialsFile: string
  readonly directory: string
  readonly signal: AbortSignal
  readonly onDurableBatch?: () => Promise<void>
}

export async function runArchiver(options: ArchiverOptions) {
  const { archiver } = z.object({ archiver: z.string().min(1) }).parse(JSON.parse(await readFile(options.credentialsFile, 'utf8')))

  const connection = await connect({ servers: options.url, user: 'archiver', pass: archiver,
    inboxPrefix: '_INBOX.archiver', reconnect: false })

  const client = jetstream(connection)
  const stop = () => { void connection.close() }

  options.signal.addEventListener('abort', stop, { once: true })

  try {
    if (options.signal.aborted) return
    await Promise.all(['RIG_FACTS', 'RIG_ASSESS'].map(async stream => {
      const consumer = await client.consumers.get(stream, 'archiver-v1')

      while (!options.signal.aborted) {
        const fetched = await consumer.fetch({ max_messages: 128, expires: 1000 })
        const messages: JsMsg[] = []

        for await (const message of fetched) messages.push(message)

        if (!messages.length) continue

        const events = messages.map(message => {
          const decoded = decodeLine(message.string())

          if (!decoded.ok) throw new Error('Invalid broker envelope')

          return { ...decoded.event, broker: { stream: message.info.stream, sequence: message.info.streamSequence } }
        })

        await writeArchiveBatch(options.directory, events)
        await options.onDurableBatch?.()

        for (const message of messages) message.ack()
        await connection.flush()
      }
    }))
  } finally {
    options.signal.removeEventListener('abort', stop)
    await connection.close()
  }
}
