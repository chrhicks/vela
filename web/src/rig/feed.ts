import { Clock, Data, Effect, Queue, Result, Schema, Stream } from 'effect'
import type { Entry } from '../../../state/entry.ts'
import { Bootstrap, entryOfFeed, FeedEntry, feedEvent, Heartbeat } from '../../../state/feed.ts'

export class FeedUnreadable extends Data.TaggedError('FeedUnreadable')<{ readonly event: string; readonly issue: string }> {}

export type FeedEvent =
  | { readonly _tag: 'State'; readonly bootstrap: Bootstrap }
  | { readonly _tag: 'Entry'; readonly entry: Entry }
  | { readonly _tag: 'Heartbeat'; readonly at: number; readonly receivedAt: number }
  | { readonly _tag: 'Lost' }

interface Sent {
  readonly name: string
  readonly data: string
}

const decodeBootstrap = Schema.decodeUnknownResult(Schema.fromJsonString(Bootstrap))
const decodeEntry = Schema.decodeUnknownResult(Schema.fromJsonString(FeedEntry))
const decodeHeartbeat = Schema.decodeUnknownResult(Schema.fromJsonString(Heartbeat))

const unreadable = (event: string) => (error: Schema.SchemaError) => new FeedUnreadable({ event, issue: error.message })

function readSent({ name, data }: Sent, receivedAt: number): Result.Result<FeedEvent, FeedUnreadable> {
  switch (name) {
    case feedEvent.state:
      return decodeBootstrap(data).pipe(Result.map(bootstrap => ({ _tag: 'State', bootstrap }) as const), Result.mapError(unreadable(name)))
    case feedEvent.entry:
      return decodeEntry(data).pipe(Result.map(sent => ({ _tag: 'Entry', entry: entryOfFeed(sent) }) as const), Result.mapError(unreadable(name)))
    case feedEvent.heartbeat:
      return decodeHeartbeat(data).pipe(Result.map(({ at }) => ({ _tag: 'Heartbeat', at, receivedAt }) as const), Result.mapError(unreadable(name)))
    default:
      return Result.succeed({ _tag: 'Lost' })
  }
}

const lost: Sent = { name: 'lost', data: '' }

export const feedEvents = (address: string): Stream.Stream<Result.Result<FeedEvent, FeedUnreadable>> =>
  Stream.callback<Sent>(queue =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const source = new EventSource(address)
        const forward = (name: string) => (message: MessageEvent<string>) => void Queue.offerUnsafe(queue, { name, data: message.data })

        source.addEventListener(feedEvent.state, forward(feedEvent.state))
        source.addEventListener(feedEvent.entry, forward(feedEvent.entry))
        source.addEventListener(feedEvent.heartbeat, forward(feedEvent.heartbeat))
        source.addEventListener('error', () => void Queue.offerUnsafe(queue, lost))

        return source
      }),
      source => Effect.sync(() => source.close()),
    ),
  ).pipe(Stream.mapEffect(sent => Effect.map(Clock.currentTimeMillis, receivedAt => readSent(sent, receivedAt))))
