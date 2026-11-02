import { readFile, mkdir } from 'node:fs/promises'
import { connect } from '@nats-io/transport-node'
import { jetstream } from '@nats-io/jetstream'
import { decodeLine, encodeEvent, subjectOf, type RigEvent } from '@vela/rig-events'
import { z } from 'zod'
import { readArchive, writeArchiveBatch } from '../run-log/archive.js'
import { createStreamModel } from './stream.js'

export interface ModelServiceOptions {
  readonly url: string
  readonly credentialsFile: string
  readonly directory: string
  readonly signal: AbortSignal
  readonly onPublished?: () => Promise<void>
}

export async function runShadowModel(options: ModelServiceOptions) {
  const { model } = z.object({ model: z.string().min(1) }).parse(JSON.parse(await readFile(options.credentialsFile, 'utf8')))
  const connection = await connect({ servers: options.url, user: 'model', pass: model, inboxPrefix: '_INBOX.model', reconnect: false })
  const client = jetstream(connection)
  const runtime = createStreamModel()
  const stop = () => { void connection.close() }

  const publish = async (events: readonly RigEvent[]) => {
    for (const event of events)
      await client.publish(subjectOf(event.rig, event.kind), encodeEvent(event), { msgID: event.id, retries: 1 })
  }

  options.signal.addEventListener('abort', stop, { once: true })

  try {
    await mkdir(options.directory, { recursive: true })

    for await (const record of readArchive(options.directory, { from: 0, to: 253402300799999 }))
      await publish(runtime.accept(record))

    const consumer = await client.consumers.get('RIG_FACTS', 'model-v1')

    while (!options.signal.aborted) {
      const message = await consumer.next({ expires: 1000 })

      if (!message) continue
      const decoded = decodeLine(message.string())

      if (!decoded.ok) throw new Error('Invalid broker envelope')
      const record = { ...decoded.event, broker: { stream: message.info.stream, sequence: message.info.streamSequence } }

      await writeArchiveBatch(options.directory, [record])
      await publish(runtime.accept(record))
      await options.onPublished?.()
      message.ack()
      await connection.flush()
    }
  } finally {
    options.signal.removeEventListener('abort', stop)
    await connection.close()
  }
}
