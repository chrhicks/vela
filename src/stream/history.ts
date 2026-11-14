import { DeliverPolicy, jetstream } from '@nats-io/jetstream'
import { Effect, Result, Stream } from 'effect'
import type { Entry, Message, UnreadableMessage } from '../../state/entry.ts'
import type { Stream as RigStream } from '../../state/stream.ts'
import { Broker, StreamUnreadable } from './follow.ts'

export interface HistoryOptions {
  readonly stream: RigStream
  readonly subjects: ReadonlyArray<string>
  readonly readBatch: number
  readonly read: (message: Message) => Result.Result<Entry, UnreadableMessage>
}

export const readHistory = ({ stream, subjects, readBatch, read }: HistoryOptions): Effect.Effect<ReadonlyArray<Entry>, StreamUnreadable, Broker> =>
  Effect.gen(function* () {
    const { connection } = yield* Broker
    const step = 'read the history'
    const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: error => new StreamUnreadable({ stream: stream.name, step, issue: String(error) }) })
    const consumer = yield* attempt(() => jetstream(connection).consumers.get(stream.name, { filter_subjects: [...subjects], deliver_policy: DeliverPolicy.All }))

    if ((yield* attempt(() => consumer.info())).num_pending === 0) return []

    const messages = yield* attempt(() => consumer.consume({ max_messages: readBatch }))

    return yield* Stream.fromAsyncIterable(messages, error => new StreamUnreadable({ stream: stream.name, step, issue: String(error) })).pipe(
      Stream.takeUntil(message => message.info.pending === 0),
      Stream.map(message => read({ seq: message.seq, subject: message.subject, time: Number(message.timestampNanos / 1_000_000n), text: message.string() })),
      Stream.filterMap(entry => entry),
      Stream.runCollect,
      Effect.map(entries => [...entries]),
      Effect.ensuring(Effect.promise(() => messages.close())),
    )
  })
