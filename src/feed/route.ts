import { createServer } from 'node:http'
import { NodeHttpServer } from '@effect/platform-node'
import { Clock, Context, Duration, Effect, Layer, Stream } from 'effect'
import { HttpRouter, HttpServerResponse, HttpStaticServer } from 'effect/http'
import type { FeedConfig } from '../settings.ts'
import { CommandsRoute } from './commands.ts'
import { Feed } from './feed.ts'
import type { NightName } from '../../state/entries.ts'
import { feedEvent, feedPath } from '../../state/feed.ts'
import { ServiceStart } from './start.ts'

export class Tonight extends Context.Service<Tonight, { readonly nightOf: (at: number) => NightName }>()('vela/Tonight') {}

export class FeedSettings extends Context.Service<FeedSettings, typeof FeedConfig.Type & { readonly rigSilentAfterSeconds: number }>()('vela/FeedSettings') {}

const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`

const feedEvents = Effect.gen(function* () {
  const feed = yield* Feed
  const { token } = yield* ServiceStart
  const { nightOf } = yield* Tonight
  const { heartbeatSeconds, lostAfterSeconds, rigSilentAfterSeconds } = yield* FeedSettings
  const limits = { heartbeatSeconds, lostAfterSeconds, rigSilentAfterSeconds }

  const heartbeats = Stream.tick(Duration.seconds(heartbeatSeconds)).pipe(
    Stream.mapEffect(() => Clock.currentTimeMillis),
    Stream.map(at => event(feedEvent.heartbeat, { at, night: nightOf(at) })),
  )

  return Stream.unwrap(
    Effect.gen(function* () {
      const { state, entries } = yield* feed.subscribe
      const at = yield* Clock.currentTimeMillis

      return Stream.concat(Stream.succeed(event(feedEvent.state, { token, at, night: nightOf(at), limits, state })), Stream.merge(entries.pipe(Stream.map(entry => event(feedEvent.entry, entry))), heartbeats))
    }),
  )
})

export const FeedRoute = HttpRouter.add(
  'GET',
  feedPath,
  Effect.map(feedEvents, events => HttpServerResponse.stream(Stream.encodeText(events), { contentType: 'text/event-stream', headers: { 'cache-control': 'no-store' } })),
)

export const WebApp = Layer.unwrap(Effect.map(FeedSettings, ({ webRoot }) => HttpStaticServer.layer({ root: webRoot, spa: true, cacheControl: 'no-cache' })))

export const FeedServer = HttpRouter.serve(Layer.mergeAll(FeedRoute, CommandsRoute, WebApp), { disableLogger: true }).pipe(
  Layer.provideMerge(
    Layer.unwrap(
      Effect.map(FeedSettings, ({ host, port }) => NodeHttpServer.layer(createServer, { port, host })),
    ),
  ),
)

