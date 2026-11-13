import { Context, Effect, Layer, PubSub, Ref, Result, Stream, type Scope } from 'effect'
import type { MalformedEntry } from '../../state/entries.ts'
import type { Entry, MalformedReading } from '../../state/entry.ts'
import { advance, emptyRig, type RigState } from '../../state/rig.ts'
import { isWanted } from '../../state/wanted.ts'

export interface FeedSubscription {
  readonly state: RigState
  readonly entries: Stream.Stream<Entry>
}

export class Feed extends Context.Service<
  Feed,
  {
    readonly receive: (entry: Entry) => Effect.Effect<void, MalformedEntry | MalformedReading>
    readonly subscribe: Effect.Effect<FeedSubscription, never, Scope.Scope>
    readonly current: Effect.Effect<RigState>
  }
>()('vela/Feed') {}

export const FeedLive = Layer.effect(
  Feed,
  Effect.gen(function* () {
    const state = yield* Ref.make(emptyRig)
    const wanted = yield* PubSub.unbounded<Entry>()

    const receive = (entry: Entry) =>
      Effect.gen(function* () {
        if (!(yield* Effect.fromResult(isWanted(entry)))) return

        const next = advance(yield* Ref.get(state), entry)

        if (Result.isSuccess(next)) yield* Ref.set(state, next.success)

        yield* PubSub.publish(wanted, entry)

        if (Result.isFailure(next)) return yield* Effect.fail(next.failure)
      })

    const subscribe = Effect.gen(function* () {
      const subscription = yield* PubSub.subscribe(wanted)
      const current = yield* Ref.get(state)
      const since = current.position

      return {
        state: current,
        entries: Stream.fromSubscription(subscription).pipe(Stream.filter(entry => since === undefined || entry.seq > since)),
      }
    })

    return { receive, subscribe, current: Ref.get(state) }
  }),
)
