import { createServer } from 'node:http'
import { NodeHttpServer } from '@effect/platform-node'
import { Clock, Context, Duration, Effect, Layer, Stream } from 'effect'
import { HttpRouter, HttpServerResponse, HttpStaticServer } from 'effect/http'
import type { FeedConfig } from '../settings.ts'
import { CommandsRoute } from './commands.ts'
import { Feed } from './feed.ts'
import type { NightName } from '../../state/entries.ts'
import { feedPath, type ControlsLimits, type FeedEventName, type LaunchLimits, type PickerLimits } from '../../state/feed.ts'
import { RememberedRoute } from './remembered.ts'
import { PreviewRoute } from './previews.ts'
import { SkyRoute } from './sky.ts'
import { StackPictureRoute } from './stack.ts'
import type { FirstFramesLimits } from '../../state/first-frames-check.ts'
import { pressedSince } from '../../state/pressing.ts'
import { ServiceStart, startedAt } from './start.ts'
import { DetailSurveyRoute, DetailSurveyTiles, SurveyRoute, SurveyTiles } from './survey.ts'
import { BestPlacedRoute, CatalogRoute, TargetRoute, TargetsRoute } from './targets.ts'

export class Tonight extends Context.Service<Tonight, { readonly nightOf: (at: number) => NightName }>()('vela/Tonight') {}

export class FeedSettings extends Context.Service<FeedSettings, typeof FeedConfig.Type & { readonly rigSilentAfterSeconds: number; readonly launch: LaunchLimits; readonly picker: PickerLimits; readonly controls: ControlsLimits; readonly firstFrames: FirstFramesLimits }>()('vela/FeedSettings') {}

const event = (name: FeedEventName, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`

const feedEvents = Effect.gen(function* () {
  const feed = yield* Feed
  const { token } = yield* ServiceStart
  const { nightOf } = yield* Tonight
  const { heartbeatSeconds, lostAfterSeconds, rigSilentAfterSeconds, launch, picker, controls, firstFrames } = yield* FeedSettings
  const limits = { heartbeatSeconds, lostAfterSeconds, rigSilentAfterSeconds }

  const heartbeats = Stream.tick(Duration.seconds(heartbeatSeconds)).pipe(
    Stream.mapEffect(() => Clock.currentTimeMillis),
    Stream.map(at => event('heartbeat', { at, night: nightOf(at) })),
  )

  return Stream.unwrap(
    Effect.gen(function* () {
      const { state, entries } = yield* feed.subscribe
      const at = yield* Clock.currentTimeMillis

      return Stream.concat(Stream.succeed(event('state', { token, at, night: nightOf(at), limits, launch, picker, controls, firstFrames, state: { ...state, pressing: pressedSince(state.pressing, startedAt(token)) } })), Stream.merge(entries.pipe(Stream.map(entry => event('entry', entry))), heartbeats))
    }),
  )
})

export const FeedRoute = HttpRouter.add(
  'GET',
  feedPath,
  Effect.map(feedEvents, events => HttpServerResponse.stream(Stream.encodeText(events), { contentType: 'text/event-stream', headers: { 'cache-control': 'no-store' } })),
)

export const WebApp = Layer.unwrap(Effect.map(FeedSettings, ({ webRoot }) => HttpStaticServer.layer({ root: webRoot, spa: true, cacheControl: 'no-cache' })))

export const FeedServer = HttpRouter.serve(Layer.mergeAll(FeedRoute, CommandsRoute, RememberedRoute, SkyRoute, PreviewRoute, StackPictureRoute, BestPlacedRoute, TargetRoute, TargetsRoute, CatalogRoute, SurveyRoute, SurveyTiles, DetailSurveyRoute, DetailSurveyTiles, WebApp), { disableLogger: true }).pipe(
  Layer.provideMerge(
    Layer.unwrap(
      Effect.map(FeedSettings, ({ host, port }) => NodeHttpServer.layer(createServer, { port, host })),
    ),
  ),
)

