import { Effect, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { Forecast } from '../../state/forecast.ts'
import type { Forecasts } from './forecasts.ts'
import { ForecastRefused, makeForecastNights } from './night.ts'

const phoenix = { latitudeDegrees: 33.45, longitudeDegrees: -112.07, elevationMeters: 331 }
const sourceState = { ageSeconds: 30, failing: false }
const afternoon = Date.parse('2026-11-15T22:00:00Z')

const nightsFor = (site: typeof phoenix | undefined) => {
  const asked: Array<{ readonly from: number; readonly until: number }> = []
  const forecasts: Forecasts = { hours: (_, from, until) => (asked.push({ from, until }), Effect.succeed({ hours: [{ at: from, coverPercent: 40, source: 'nws' as const }], nws: sourceState, openMeteo: { ageSeconds: null, failing: false } })) }

  return { asked, nights: makeForecastNights({ site: () => site, forecasts, cloudyPercent: 50 }) }
}

describe('the forecast for a night', () => {
  it('asks for the hours from dusk to dawn of the night the time falls in and says the cloudy percent', async () => {
    const { asked, nights } = nightsFor(phoenix)
    const answer = await Effect.runPromise(nights.night(afternoon))

    expect(Schema.decodeUnknownSync(Forecast)(answer)).toMatchObject({ at: afternoon, cloudyPercent: 50 })
    expect(asked).toHaveLength(1)
    expect(asked[0]!.from).toBeGreaterThan(afternoon)
    expect(asked[0]!.until - asked[0]!.from).toBeGreaterThan(8 * 3_600_000)
  })

  it('refuses with no-site when the mount has not reported one, and asks nothing', async () => {
    const { asked, nights } = nightsFor(undefined)
    const refusal = await Effect.runPromise(Effect.flip(nights.night(afternoon)))

    expect(refusal).toBeInstanceOf(ForecastRefused)
    expect(refusal.refusal).toEqual({ code: 'no-site' })
    expect(asked).toEqual([])
  })

  it('refuses with no-night where the Sun does not set', async () => {
    const { nights } = nightsFor({ latitudeDegrees: 80, longitudeDegrees: 0, elevationMeters: 0 })
    const refusal = await Effect.runPromise(Effect.flip(nights.night(Date.parse('2026-06-21T12:00:00Z'))))

    expect(refusal.refusal).toEqual({ code: 'no-night' })
  })
})
