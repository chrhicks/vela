import { DeliverPolicy, jetstream, type JsMsg } from '@nats-io/jetstream'
import { connect, type NatsConnection } from '@nats-io/transport-node'
import type { Result } from 'effect'
import type { Entry, Message, UnreadableMessage } from '../../state/entry.ts'
import type { Stream } from '../../state/stream.ts'
import type { BrokerSettings } from './broker.ts'
import { makeConnectionFinder } from './connection.ts'

export interface Following {
  readonly connection: NatsConnection
  readonly done: Promise<void>
}

function messageOf(message: JsMsg): Message {
  return { seq: message.seq, subject: message.subject, time: Number(message.timestampNanos / 1_000_000n), text: message.string() }
}

export async function followRig(options: {
  readonly broker: BrokerSettings
  readonly stream: Stream
  readonly read: (message: Message) => Result.Result<Entry, UnreadableMessage>
  readonly onUnreadable: (error: UnreadableMessage) => void
  readonly readBatch: number
  readonly onMessage: (message: Message) => void
  readonly onCaughtUp: () => void
}): Promise<Following> {
  const connection = await connect({ ...options.broker, name: 'vela', reconnect: false })
  const client = jetstream(connection)

  async function latestConnectionStart() {
    const finder = makeConnectionFinder(options.read, options.onUnreadable)
    const consumer = await client.consumers.get(options.stream.name, { filter_subjects: [options.stream.client], deliver_policy: DeliverPolicy.All })

    if ((await consumer.info()).num_pending === 0) return undefined

    const messages = await consumer.consume({ max_messages: options.readBatch })

    for await (const message of messages) {
      finder.take(messageOf(message))
      if (message.info.pending === 0) {
        void messages.stop()
        break
      }
    }

    return finder.start()
  }

  async function replayAndFollow(start: number | undefined) {
    const consumer = await client.consumers.get(options.stream.name, {
      filter_subjects: [...options.stream.followed],
      ...(start === undefined ? { deliver_policy: DeliverPolicy.New } : { deliver_policy: DeliverPolicy.StartSequence, opt_start_seq: start }),
    })

    let caught = start === undefined || (await consumer.info()).num_pending === 0

    if (caught) options.onCaughtUp()

    const messages = await consumer.consume({ max_messages: options.readBatch })

    for await (const message of messages) {
      options.onMessage(messageOf(message))
      if (!caught && message.info.pending === 0) {
        caught = true
        options.onCaughtUp()
      }
    }
  }

  const done = latestConnectionStart().then(replayAndFollow)

  return { connection, done }
}
