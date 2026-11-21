import { Clock, Context, DateTime, Effect, Match } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http'
import type { HorizonNight, HorizonPaths, HorizonRefusal } from '../../state/horizon-night.ts'
import { HorizonNightAsked, HorizonPathsAsked, horizonNightPath, horizonPathsPath } from '../../state/horizon-night.ts'
import type { HorizonNightRefused } from '../catalog/horizon-night.ts'

export class HorizonNights extends Context.Service<
  HorizonNights,
  {
    readonly night: (id: string, at: number) => Effect.Effect<HorizonNight, HorizonNightRefused>
    readonly paths: (ids: ReadonlyArray<string>, at: number) => Effect.Effect<HorizonPaths, HorizonNightRefused>
  }
>()('vela/HorizonNights') {}

const refused = (status: number, refusal: HorizonRefusal) => HttpServerResponse.jsonUnsafe(refusal, { status })

const statusOf = (refusal: HorizonRefusal) =>
  Match.value(refusal).pipe(
    Match.discriminatorsExhaustive('code')({
      malformed: () => 400,
      'unknown-target': () => 404,
      'no-site': () => 503,
      'no-night': () => 422,
    }),
  )

export const HorizonNightRoute = HttpRouter.add(
  'GET',
  horizonNightPath,
  Effect.gen(function* () {
    const nights = yield* HorizonNights
    const asked = yield* HttpServerRequest.schemaSearchParams(HorizonNightAsked)
    const at = asked.at === undefined ? yield* Clock.currentTimeMillis : DateTime.toEpochMillis(asked.at)

    return HttpServerResponse.jsonUnsafe(yield* nights.night(asked.target, at), { headers: { 'cache-control': 'no-store' } })
  }).pipe(
    Effect.catchTags({
      SchemaError: () => Effect.succeed(refused(400, { code: 'malformed' })),
      HorizonNightRefused: ({ refusal }) => Effect.succeed(refused(statusOf(refusal), refusal)),
    }),
  ),
)

export const HorizonPathsRoute = HttpRouter.add(
  'GET',
  horizonPathsPath,
  Effect.gen(function* () {
    const nights = yield* HorizonNights
    const asked = yield* HttpServerRequest.schemaSearchParams(HorizonPathsAsked)
    const at = asked.at === undefined ? yield* Clock.currentTimeMillis : DateTime.toEpochMillis(asked.at)

    return HttpServerResponse.jsonUnsafe(yield* nights.paths(asked.targets, at), { headers: { 'cache-control': 'no-store' } })
  }).pipe(
    Effect.catchTags({
      SchemaError: () => Effect.succeed(refused(400, { code: 'malformed' })),
      HorizonNightRefused: ({ refusal }) => Effect.succeed(refused(statusOf(refusal), refusal)),
    }),
  ),
)
