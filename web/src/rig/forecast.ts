import { Effect, Schema } from 'effect'
import { Forecast, forecastPath } from '../../../state/forecast.ts'
import { asked, bodyOf } from './targets.ts'

export type ForecastReading = { readonly status: 'forecast'; readonly forecast: Forecast } | { readonly status: 'unavailable' }

const unavailable: Effect.Effect<ForecastReading> = Effect.succeed({ status: 'unavailable' })

const reading = (at: number): Effect.Effect<ForecastReading> =>
  asked(`${forecastPath}?${new URLSearchParams({ at: new Date(at).toISOString() })}`).pipe(
    Effect.flatMap(response =>
      response.ok
        ? bodyOf(response).pipe(Effect.flatMap(body => Schema.decodeUnknownEffect(Forecast)(body)), Effect.map((forecast): ForecastReading => ({ status: 'forecast', forecast })))
        : unavailable,
    ),
    Effect.catchTags({ UnknownError: () => unavailable, SchemaError: () => unavailable }),
  )

export const forecastReading = (at: number): Promise<ForecastReading> => Effect.runPromise(reading(at))
