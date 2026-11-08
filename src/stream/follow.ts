import { DeliverPolicy, jetstream } from '@nats-io/jetstream'
import { connect, type NatsConnection } from '@nats-io/transport-node'
import type { BrokerSettings } from './broker.ts'
import { clientSubject, followedSubjects, makeConnectionFinder, streamName } from './connection.ts'

export interface Message {
  readonly seq: number
  readonly subject: string
  readonly text: string
}

export interface Following {
  readonly connection: NatsConnection
  readonly done: Promise<void>
}

export async function followRig(options: {
  readonly broker: BrokerSettings
  readonly readBatch: number
  readonly onMessage: (message: Message) => void
  readonly onCaughtUp: () => void
}): Promise<Following> {
  const connection = await connect({ ...options.broker, name: 'vela', reconnect: false })
  const client = jetstream(connection)

  async function latestConnectionStart() {
    const finder = makeConnectionFinder()
    const consumer = await client.consumers.get(streamName, { filter_subjects: [clientSubject], deliver_policy: DeliverPolicy.All })

    if ((await consumer.info()).num_pending === 0) return undefined

    const messages = await consumer.consume({ max_messages: options.readBatch })

    for await (const message of messages) {
      finder.take(message.seq, message.string())
      if (message.info.pending === 0) {
        void messages.stop()
        break
      }
    }

    return finder.start()
  }

  async function replayAndFollow(start: number | undefined) {
    const consumer = await client.consumers.get(streamName, {
      filter_subjects: followedSubjects,
      ...(start === undefined ? { deliver_policy: DeliverPolicy.New } : { deliver_policy: DeliverPolicy.StartSequence, opt_start_seq: start }),
    })

    let caught = start === undefined || (await consumer.info()).num_pending === 0

    if (caught) options.onCaughtUp()

    const messages = await consumer.consume({ max_messages: options.readBatch })

    for await (const message of messages) {
      options.onMessage({ seq: message.seq, subject: message.subject, text: message.string() })
      if (!caught && message.info.pending === 0) {
        caught = true
        options.onCaughtUp()
      }
    }
  }

  const done = latestConnectionStart().then(replayAndFollow)

  return { connection, done }
}
