import { createServer } from 'node:http'
import { NodeHttpServer } from '@effect/platform-node'
import { Clock, Context, Duration, Effect, Layer, Stream } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/http'
import type { FeedConfig } from '../settings.ts'
import { Feed } from './feed.ts'
import { ServiceVersion } from './version.ts'

export class FeedSettings extends Context.Service<FeedSettings, typeof FeedConfig.Type>()('vela/FeedSettings') {}

const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`

const feedEvents = Effect.gen(function* () {
  const feed = yield* Feed
  const { commit } = yield* ServiceVersion
  const { heartbeatSeconds } = yield* FeedSettings

  const heartbeats = Stream.tick(Duration.seconds(heartbeatSeconds)).pipe(
    Stream.mapEffect(() => Clock.currentTimeMillis),
    Stream.map(at => event('heartbeat', { at })),
  )

  return Stream.unwrap(
    Effect.gen(function* () {
      const { state, entries } = yield* feed.follow
      const at = yield* Clock.currentTimeMillis

      return Stream.concat(Stream.succeed(event('state', { version: commit, at, state })), Stream.merge(entries.pipe(Stream.map(entry => event('entry', entry))), heartbeats))
    }),
  )
})

export const FeedRoute = HttpRouter.add(
  'GET',
  '/feed',
  Effect.map(feedEvents, events => HttpServerResponse.stream(Stream.encodeText(events), { contentType: 'text/event-stream', headers: { 'cache-control': 'no-store' } })),
)

export const FeedServer = HttpRouter.serve(FeedRoute, { disableLogger: true }).pipe(
  Layer.provide(
    Layer.unwrap(
      Effect.map(FeedSettings, ({ port }) => NodeHttpServer.layer(createServer, { port, host: '127.0.0.1' })),
    ),
  ),
)
