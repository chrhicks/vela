import { DeliverPolicy, jetstream, type JsMsg } from '@nats-io/jetstream'
import { connect, type NatsConnection } from '@nats-io/transport-node'
import { Context, Data, Effect, Layer, Stream, type Result } from 'effect'
import type { Entry, Message, UnreadableMessage } from '../../state/entry.ts'
import type { Stream as RigStream } from '../../state/stream.ts'
import type { BrokerSettings } from './broker.ts'
import { makeConnectionFinder } from './connection.ts'

export class BrokerUnreachable extends Data.TaggedError('BrokerUnreachable')<{ readonly servers: string; readonly issue: string }> {}

export class BrokerLost extends Data.TaggedError('BrokerLost')<{ readonly issue: string | undefined }> {}

export class StreamUnreadable extends Data.TaggedError('StreamUnreadable')<{ readonly stream: string; readonly step: string; readonly issue: string }> {}

export class FollowEnded extends Data.TaggedError('FollowEnded')<{ readonly stream: string }> {}

export class Broker extends Context.Service<Broker, { readonly connection: NatsConnection }>()('vela/Broker') {}

export const brokerOf = (settings: BrokerSettings) =>
  Layer.effect(
    Broker,
    Effect.acquireRelease(
      Effect.tryPromise({
        try: () => connect({ ...settings, name: 'vela', reconnect: false }),
        catch: error => new BrokerUnreachable({ servers: settings.servers, issue: String(error) }),
      }),
      connection => Effect.promise(() => connection.close()),
    ).pipe(Effect.map(connection => ({ connection }))),
  )

export type Followed = { readonly _tag: 'Message'; readonly message: Message } | { readonly _tag: 'CaughtUp' }

export interface Pending {
  readonly message: Message
  readonly pending: number
}

export const withCaughtUp =
  (caughtAtStart: boolean) =>
  <E, R>(messages: Stream.Stream<Pending, E, R>): Stream.Stream<Followed, E, R> => {
    const followed = messages.pipe(
      Stream.mapAccum(
        () => caughtAtStart,
        (caught, { message, pending }): readonly [boolean, ReadonlyArray<Followed>] =>
          !caught && pending === 0 ? [true, [{ _tag: 'Message', message }, { _tag: 'CaughtUp' }]] : [caught, [{ _tag: 'Message', message }]],
      ),
    )

    return caughtAtStart ? Stream.concat(Stream.succeed<Followed>({ _tag: 'CaughtUp' }), followed) : followed
  }

const pendingOf = (message: JsMsg): Pending => ({
  message: { seq: message.seq, subject: message.subject, time: Number(message.timestampNanos / 1_000_000n), text: message.string() },
  pending: message.info.pending,
})

export function followRig(options: {
  readonly stream: RigStream
  readonly readBatch: number
  readonly read: (message: Message) => Result.Result<Entry, UnreadableMessage>
  readonly onUnreadable: (error: UnreadableMessage) => void
}): Stream.Stream<Followed, StreamUnreadable | BrokerLost | FollowEnded, Broker> {
  const name = options.stream.name

  return Stream.unwrap(
    Effect.gen(function* () {
      const { connection } = yield* Broker
      const client = jetstream(connection)
      const attempt = <A>(step: string, run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: error => new StreamUnreadable({ stream: name, step, issue: String(error) }) })
      const consumed = (step: string, messages: AsyncIterable<JsMsg>) => Stream.fromAsyncIterable(messages, error => new StreamUnreadable({ stream: name, step, issue: String(error) })).pipe(Stream.map(pendingOf))

      const latestConnectionStart = Effect.gen(function* () {
        const finder = makeConnectionFinder(options.read, options.onUnreadable)
        const consumer = yield* attempt('find the latest connection', () => client.consumers.get(name, { filter_subjects: [options.stream.client], deliver_policy: DeliverPolicy.All }))

        if ((yield* attempt('find the latest connection', () => consumer.info())).num_pending === 0) return undefined

        const messages = yield* attempt('find the latest connection', () => consumer.consume({ max_messages: options.readBatch }))

        yield* consumed('find the latest connection', messages).pipe(
          Stream.takeUntil(({ pending }) => pending === 0),
          Stream.runForEach(({ message }) => Effect.sync(() => finder.take(message))),
          Effect.ensuring(Effect.promise(() => messages.close())),
        )

        return finder.start()
      })

      const start = yield* latestConnectionStart
      const consumer = yield* attempt('follow', () =>
        client.consumers.get(name, {
          filter_subjects: [...options.stream.followed],
          ...(start === undefined ? { deliver_policy: DeliverPolicy.New } : { deliver_policy: DeliverPolicy.StartSequence, opt_start_seq: start }),
        }),
      )
      const caughtAtStart = start === undefined || (yield* attempt('follow', () => consumer.info())).num_pending === 0
      const messages = yield* attempt('follow', () => consumer.consume({ max_messages: options.readBatch }))
      const lost = Stream.fromEffect(Effect.promise(() => connection.closed())).pipe(Stream.flatMap(error => Stream.fail(new BrokerLost({ issue: error?.message }))))

      return Stream.merge(Stream.concat(consumed('follow', messages).pipe(withCaughtUp(caughtAtStart)), Stream.fail(new FollowEnded({ stream: name }))), lost)
    }),
  )
}
