import { Schema } from 'effect'

export const forecastPath = '/forecast'

export const ForecastAsked = Schema.Struct({ at: Schema.optionalKey(Schema.DateTimeUtcFromString) })

export type ForecastAsked = typeof ForecastAsked.Type

export const CloudSource = Schema.Literals(['nws', 'open-meteo'])

export type CloudSource = typeof CloudSource.Type

export const ForecastHour = Schema.Struct({
  at: Schema.Number,
  coverPercent: Schema.NullOr(Schema.Number),
  source: Schema.NullOr(CloudSource),
})

export type ForecastHour = typeof ForecastHour.Type

export const SourceState = Schema.Struct({
  ageSeconds: Schema.NullOr(Schema.Number),
  failing: Schema.Boolean,
})

export type SourceState = typeof SourceState.Type

export const Forecast = Schema.Struct({
  at: Schema.Number,
  cloudyPercent: Schema.Number,
  hours: Schema.Array(ForecastHour),
  nws: SourceState,
  openMeteo: SourceState,
})

export type Forecast = typeof Forecast.Type

export const ForecastRefusal = Schema.Union([
  Schema.Struct({ code: Schema.Literal('malformed') }),
  Schema.Struct({ code: Schema.Literal('no-site') }),
  Schema.Struct({ code: Schema.Literal('no-night') }),
])

export type ForecastRefusal = typeof ForecastRefusal.Type
