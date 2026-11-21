import { Clock, Context, DateTime, Effect, Match } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http'
import type { Forecast, ForecastRefusal } from '../../state/forecast.ts'
import { ForecastAsked, forecastPath } from '../../state/forecast.ts'
import type { ForecastRefused } from '../forecast/night.ts'

export class ForecastNights extends Context.Service<ForecastNights, { readonly night: (at: number) => Effect.Effect<Forecast, ForecastRefused> }>()('vela/ForecastNights') {}

const refused = (status: number, refusal: ForecastRefusal) => HttpServerResponse.jsonUnsafe(refusal, { status })

const statusOf = (refusal: ForecastRefusal) =>
  Match.value(refusal).pipe(
    Match.discriminatorsExhaustive('code')({
      malformed: () => 400,
      'no-site': () => 503,
      'no-night': () => 422,
    }),
  )

export const ForecastRoute = HttpRouter.add(
  'GET',
  forecastPath,
  Effect.gen(function* () {
    const nights = yield* ForecastNights
    const asked = yield* HttpServerRequest.schemaSearchParams(ForecastAsked)
    const at = asked.at === undefined ? yield* Clock.currentTimeMillis : DateTime.toEpochMillis(asked.at)

    return HttpServerResponse.jsonUnsafe(yield* nights.night(at), { headers: { 'cache-control': 'no-store' } })
  }).pipe(
    Effect.catchTags({
      SchemaError: () => Effect.succeed(refused(400, { code: 'malformed' })),
      ForecastRefused: ({ refusal }) => Effect.succeed(refused(statusOf(refusal), refusal)),
    }),
  ),
)
