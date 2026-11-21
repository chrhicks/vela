import { Data, Effect } from 'effect'
import type { Forecast, ForecastRefusal } from '../../state/forecast.ts'
import type { Site } from '../pointing/target.ts'
import { nightTimes } from '../sky/darkness.ts'
import type { Forecasts } from './forecasts.ts'

export class ForecastRefused extends Data.TaggedError('ForecastRefused')<{ readonly refusal: ForecastRefusal }> {}

export interface ForecastNightOptions {
  readonly site: () => Site | undefined
  readonly forecasts: Forecasts
  readonly cloudyPercent: number
}

export const makeForecastNights = ({ site, forecasts, cloudyPercent }: ForecastNightOptions) => ({
  night: (at: number): Effect.Effect<Forecast, ForecastRefused> =>
    Effect.gen(function* () {
      const here = site()

      if (here === undefined) return yield* Effect.fail(new ForecastRefused({ refusal: { code: 'no-site' } }))

      const night = nightTimes(here, at)

      if (night === undefined) return yield* Effect.fail(new ForecastRefused({ refusal: { code: 'no-night' } }))

      const found = yield* forecasts.hours(here, night.duskAt, night.dawnAt)

      return { at, cloudyPercent, ...found }
    }),
})
