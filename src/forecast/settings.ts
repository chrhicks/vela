import { Schema } from 'effect'
import { described } from '../config.ts'

export const ForecastSettings = Schema.Struct({
  nwsAddress: described("The address of the National Weather Service's API, which gives the hourly sky cover of the grid point the site falls in", Schema.String, 'https://api.weather.gov'),
  openMeteoAddress: described("The address of Open-Meteo's API, which gives the hourly cloud cover for the hours the National Weather Service has none for", Schema.String, 'https://api.open-meteo.com'),
  userAgent: described('The User-Agent header sent with every forecast request, with no contact or personal details', Schema.NonEmptyString, 'vela'),
  positionDecimals: described("How many decimal places, in degrees, the site's position is rounded to in a forecast request", Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)), 4),
  refreshMinutes: described('Minutes after a forecast source answered before the next request for the same site asks it again', Schema.Number.check(Schema.isGreaterThan(0)), 60),
  retryMinutes: described('Minutes after a forecast source failed, or its grid point could not be looked up, before the next request for the same site tries it again', Schema.Number.check(Schema.isGreaterThan(0)), 5),
  requestTimeoutSeconds: described('Seconds one forecast request may take before it counts as failed', Schema.Number.check(Schema.isGreaterThan(0)), 10),
  openMeteoPastHours: described('How many hours before now Open-Meteo is asked for, so hours of tonight that have already begun have a value', Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)), 24),
  openMeteoForecastDays: described('How many days ahead Open-Meteo is asked for', Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)), 3),
})

export type ForecastSettings = typeof ForecastSettings.Type
