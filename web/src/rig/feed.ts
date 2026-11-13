import { Clock, Data, Effect, Queue, Result, Schema, Stream } from 'effect'
import type { NightName } from '../../../state/entries.ts'
import type { Entry } from '../../../state/entry.ts'
import { Bootstrap, entryOfFeed, FeedEntry, feedEvent, Heartbeat } from '../../../state/feed.ts'

export class FeedUnreadable extends Data.TaggedError('FeedUnreadable')<{ readonly event: string; readonly issue: string }> {}

export type FeedEvent =
  | { readonly _tag: 'State'; readonly bootstrap: Bootstrap; readonly receivedAt: number }
  | { readonly _tag: 'Entry'; readonly entry: Entry }
  | { readonly _tag: 'Heartbeat'; readonly at: number; readonly night: NightName; readonly receivedAt: number }
  | { readonly _tag: 'Lost' }

interface ServerMessage {
  readonly name: string
  readonly data: string
}

const decodeBootstrap = Schema.decodeUnknownResult(Schema.fromJsonString(Bootstrap))
const decodeEntry = Schema.decodeUnknownResult(Schema.fromJsonString(FeedEntry))
const decodeHeartbeat = Schema.decodeUnknownResult(Schema.fromJsonString(Heartbeat))

const unreadable = (event: string) => (error: Schema.SchemaError) => new FeedUnreadable({ event, issue: error.message })

function decodeServerMessage({ name, data }: ServerMessage, receivedAt: number): Result.Result<FeedEvent, FeedUnreadable> {
  switch (name) {
    case feedEvent.state:
      return decodeBootstrap(data).pipe(Result.map(bootstrap => ({ _tag: 'State', bootstrap, receivedAt }) as const), Result.mapError(unreadable(name)))
    case feedEvent.entry:
      return decodeEntry(data).pipe(Result.map(sent => ({ _tag: 'Entry', entry: entryOfFeed(sent) }) as const), Result.mapError(unreadable(name)))
    case feedEvent.heartbeat:
      return decodeHeartbeat(data).pipe(Result.map(({ at, night }) => ({ _tag: 'Heartbeat', at, night, receivedAt }) as const), Result.mapError(unreadable(name)))
    default:
      return Result.succeed({ _tag: 'Lost' })
  }
}

const connectionError: ServerMessage = { name: 'error', data: '' }

export const feedEvents = (address: string): Stream.Stream<Result.Result<FeedEvent, FeedUnreadable>> =>
  Stream.callback<ServerMessage>(queue =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const source = new EventSource(address)
        const queueMessage = (name: string) => (message: MessageEvent<string>) => void Queue.offerUnsafe(queue, { name, data: message.data })

        source.addEventListener(feedEvent.state, queueMessage(feedEvent.state))
        source.addEventListener(feedEvent.entry, queueMessage(feedEvent.entry))
        source.addEventListener(feedEvent.heartbeat, queueMessage(feedEvent.heartbeat))
        source.addEventListener('error', () => void Queue.offerUnsafe(queue, connectionError))

        return source
      }),
      source => Effect.sync(() => source.close()),
    ),
  ).pipe(Stream.mapEffect(message => Effect.map(Clock.currentTimeMillis, receivedAt => decodeServerMessage(message, receivedAt))))
