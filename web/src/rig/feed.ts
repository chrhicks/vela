import { Clock, Data, Effect, Queue, Result, Schema, Stream } from 'effect'
import type { NightName } from '../../../state/entries.ts'
import type { Entry } from '../../../state/entry.ts'
import { Bootstrap, entryOfFeed, FeedEntry, FeedEventName, Heartbeat } from '../../../state/feed.ts'

export class FeedUnreadable extends Data.TaggedError('FeedUnreadable')<{ readonly event: string; readonly issue: string }> {}

export type FeedEvent =
  | { readonly _tag: 'State'; readonly bootstrap: Bootstrap; readonly receivedAt: number }
  | { readonly _tag: 'Entry'; readonly entry: Entry }
  | { readonly _tag: 'Heartbeat'; readonly at: number; readonly night: NightName; readonly receivedAt: number }
  | { readonly _tag: 'Lost' }

type ServerMessage = { readonly _tag: 'Message'; readonly name: FeedEventName; readonly data: string } | { readonly _tag: 'Lost' }

const decodeBootstrap = Schema.decodeUnknownResult(Schema.fromJsonString(Bootstrap))
const decodeEntry = Schema.decodeUnknownResult(Schema.fromJsonString(FeedEntry))
const decodeHeartbeat = Schema.decodeUnknownResult(Schema.fromJsonString(Heartbeat))

const unreadable = (event: string) => (error: Schema.SchemaError) => new FeedUnreadable({ event, issue: error.message })

function decodeServerMessage(message: ServerMessage, receivedAt: number): Result.Result<FeedEvent, FeedUnreadable> {
  if (message._tag === 'Lost') return Result.succeed({ _tag: 'Lost' })

  const { name, data } = message

  switch (name) {
    case 'state':
      return decodeBootstrap(data).pipe(Result.map((bootstrap): FeedEvent => ({ _tag: 'State', bootstrap, receivedAt })), Result.mapError(unreadable(name)))
    case 'entry':
      return decodeEntry(data).pipe(Result.map((sent): FeedEvent => ({ _tag: 'Entry', entry: entryOfFeed(sent) })), Result.mapError(unreadable(name)))
    case 'heartbeat':
      return decodeHeartbeat(data).pipe(Result.map(({ at, night }): FeedEvent => ({ _tag: 'Heartbeat', at, night, receivedAt })), Result.mapError(unreadable(name)))
  }
}

const lost: ServerMessage = { _tag: 'Lost' }

export const feedEvents = (address: string): Stream.Stream<Result.Result<FeedEvent, FeedUnreadable>> =>
  Stream.callback<ServerMessage>(queue =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const source = new EventSource(address)
        const queueMessage = (name: FeedEventName) => (message: MessageEvent<string>) => void Queue.offerUnsafe(queue, { _tag: 'Message', name, data: message.data })

        for (const name of FeedEventName.literals) source.addEventListener(name, queueMessage(name))
        source.addEventListener('error', () => void Queue.offerUnsafe(queue, lost))

        return source
      }),
      source => Effect.sync(() => source.close()),
    ),
  ).pipe(Stream.mapEffect(message => Effect.map(Clock.currentTimeMillis, receivedAt => decodeServerMessage(message, receivedAt))))
