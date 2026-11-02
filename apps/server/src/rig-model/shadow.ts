import { readFile } from 'node:fs/promises'
import { connect } from '@nats-io/transport-node'
import { jetstream, type JsMsg } from '@nats-io/jetstream'
import { decodeLine, encodeEvent, subjectOf, type RigEvent } from '@vela/rig-events'
import { z } from 'zod'
import { recoverFacts } from './recovery.js'
import { createStreamModel } from './stream.js'
import { checkpointStore } from './checkpoint.js'

export interface ModelServiceOptions {
  readonly url: string
  readonly credentialsFile: string
  readonly directory: string
  readonly archiveDirectory: string
  readonly onRecovery?: (path: 'checkpoint' | 'archive') => void
  readonly signal: AbortSignal
  readonly onPublished?: (sequence: number) => Promise<void>
}

export async function runShadowModel(options: ModelServiceOptions) {
  const { model } = z.object({ model: z.string().min(1) }).parse(JSON.parse(await readFile(options.credentialsFile, 'utf8')))
  const connection = await connect({ servers: options.url, user: 'model', pass: model, inboxPrefix: '_INBOX.model', reconnect: false })
  const client = jetstream(connection)
  const store = checkpointStore(options.directory)
  let runtime = createStreamModel()
  const pending: JsMsg[] = []
  let lastCheckpoint = Date.now()

  const checkpoint = async () => {
    if (!pending.length) return
    await store.save(runtime.snapshot())

    for (const message of pending) message.ack()
    await connection.flush()
    pending.length = 0
    lastCheckpoint = Date.now()
  }

  const stop = () => { void connection.close() }

  const publish = async (events: readonly RigEvent[]) => {
    for (const event of events) {
      await client.publish(subjectOf(event.rig, event.kind), encodeEvent(event), { msgID: event.id, retries: 1 })
      runtime.published(event)
    }
  }

  options.signal.addEventListener('abort', stop, { once: true })

  try {
    const consumer = await client.consumers.get('RIG_FACTS', 'model-v1')
    const info = await consumer.info()
    const floor = info.ack_floor.stream_seq
    const saved = await store.load()

    if (saved && (saved.sequences.get('RIG_FACTS') ?? 0) >= floor) {
      runtime = createStreamModel(saved)
      options.onRecovery?.('checkpoint')
    } else if (floor > 0) {
      for await (const record of recoverFacts(options.archiveDirectory, options.directory, floor)) {
        await publish(runtime.accept(record))
      }

      if ((runtime.snapshot().sequences.get('RIG_FACTS') ?? 0) < floor)
        throw new Error('Model archive has not reached the durable consumer ack floor')
      await store.save(runtime.snapshot())
      options.onRecovery?.('archive')
    }

    while (!options.signal.aborted) {
      const message = await consumer.next({ expires: 1000 })

      if (!message) {
        if (Date.now() - lastCheckpoint >= 2000) await checkpoint()
        continue
      }

      const applied = runtime.snapshot().sequences.get(message.info.stream) ?? 0

      // JetStream can send fresh facts before outstanding deliveries become due again.
      if (applied < info.delivered.stream_seq && message.info.streamSequence > applied + 1) {
        message.nak(1000)
        continue
      }

      const decoded = decodeLine(message.string())

      if (!decoded.ok) throw new Error('Invalid broker envelope')
      const record = { ...decoded.event, broker: { stream: message.info.stream, sequence: message.info.streamSequence } }

      await publish(runtime.accept(record))
      await options.onPublished?.(message.info.streamSequence)
      pending.push(message)

      if (pending.length >= 128 || Date.now() - lastCheckpoint >= 2000) await checkpoint()
    }
  } finally {
    options.signal.removeEventListener('abort', stop)
    await connection.close()
  }
}
