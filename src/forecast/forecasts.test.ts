import { Duration, Effect } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from 'vitest'
import { makeForecasts, type ForecastOptions } from './forecasts.ts'
import { ForecastSettings } from './settings.ts'
import { ForecastUnreachable, type ForecastSource } from './source.ts'
import { Schema } from 'effect'

const hour = 3_600_000
const midnight = Date.parse('2026-11-21T00:00:00Z')
const phoenix = { latitudeDegrees: 33.45, longitudeDegrees: -112.07, elevationMeters: 331 }
const elsewhere = { latitudeDegrees: 45, longitudeDegrees: -100, elevationMeters: 10 }
const settings = Schema.decodeSync(ForecastSettings)({})

type Answer = unknown | Error

interface Calls {
  readonly addresses: Array<string>
}

const point = { properties: { gridId: 'TST', gridX: 10, gridY: 20 } }

const nwsAnswer = (values: ReadonlyArray<{ readonly validTime: string; readonly value: number | null }>) => ({ properties: { skyCover: { values } } })

const openMeteoAnswer = (hours: ReadonlyArray<readonly [number, number | null]>) => ({ hourly: { time: hours.map(([h]) => (midnight + h * hour) / 1000), cloud_cover: hours.map(([, value]) => value) } })

function sourceOf(answers: { points: Array<Answer>; grid: Array<Answer>; openMeteo: Array<Answer> }): { source: ForecastSource; calls: Calls } {
  const calls: Calls = { addresses: [] }
  const take = (list: Array<Answer>) => {
    const next = list.length > 1 ? list.shift() : list[0]

    return next instanceof Error ? Effect.fail(new ForecastUnreachable({ reason: next.message })) : Effect.succeed(next)
  }

  return {
    calls,
    source: {
      json: address => {
        calls.addresses.push(address)

        if (address.includes('/points/')) return take(answers.points)
        if (address.includes('/gridpoints/')) return take(answers.grid)

        return take(answers.openMeteo)
      },
    },
  }
}

const run = <A>(options: Partial<ForecastOptions> & { readonly source: ForecastSource }, program: (service: Awaited<ReturnType<typeof build>>, clock: typeof TestClock) => Effect.Effect<A>, reports: Array<string> = []) =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.setTime(midnight + 2 * hour)
      const service = yield* makeForecasts({ settings, report: line => Effect.sync(() => void reports.push(line)), ...options })

      return yield* program(service, TestClock)
    }).pipe(Effect.provide(TestClock.layer())),
  )

const build = () => makeForecasts({ source: { json: () => Effect.succeed(null) }, settings, report: () => Effect.void }).pipe(Effect.runPromise)

const hoursOf = (answer: { readonly hours: ReadonlyArray<{ readonly at: number; readonly coverPercent: number | null; readonly source: string | null }> }) => answer.hours.map(found => [(found.at - midnight) / hour, found.coverPercent, found.source])

describe('the cloud forecast', () => {
  it('uses National Weather Service cover for the hours it has, keeping 0, and Open-Meteo for the rest, and leaves the others unknown', async () => {
    const { source } = sourceOf({
      points: [point],
      grid: [nwsAnswer([{ validTime: '2026-11-21T04:00:00+00:00/PT2H', value: 0 }, { validTime: '2026-11-21T06:00:00+00:00/PT1H', value: 70 }])],
      openMeteo: [openMeteoAnswer([[3, 10], [4, 99], [7, 0], [8, null]])],
    })

    const answer = await run({ source }, service => service.hours(phoenix, midnight + 3 * hour + 600_000, midnight + 9 * hour + 1))

    expect(hoursOf(answer)).toEqual([
      [3, 10, 'open-meteo'],
      [4, 0, 'nws'],
      [5, 0, 'nws'],
      [6, 70, 'nws'],
      [7, 0, 'open-meteo'],
      [8, null, null],
      [9, null, null],
    ])
  })

  it('does not ask Open-Meteo when the National Weather Service has every hour', async () => {
    const { source, calls } = sourceOf({ points: [point], grid: [nwsAnswer([{ validTime: '2026-11-21T03:00:00+00:00/PT6H', value: 20 }])], openMeteo: [openMeteoAnswer([])] })

    await run({ source }, service => service.hours(phoenix, midnight + 3 * hour, midnight + 8 * hour))

    expect(calls.addresses.filter(address => address.includes('open-meteo'))).toEqual([])
  })

  it('says which source each hour came from and how old each answer is', async () => {
    const { source } = sourceOf({ points: [point], grid: [nwsAnswer([{ validTime: '2026-11-21T04:00:00+00:00/PT1H', value: 30 }])], openMeteo: [openMeteoAnswer([[3, 5]])] })

    const answer = await run({ source }, (service, clock) =>
      Effect.gen(function* () {
        yield* service.hours(phoenix, midnight + 3 * hour, midnight + 5 * hour)
        yield* clock.adjust(Duration.minutes(10))

        return yield* service.hours(phoenix, midnight + 3 * hour, midnight + 5 * hour)
      }),
    )

    expect(answer.nws).toEqual({ ageSeconds: 600, failing: false })
    expect(answer.openMeteo).toEqual({ ageSeconds: 600, failing: false })
  })

  it('sends the position rounded to four decimals, the same way to both services, and nothing else of the site', async () => {
    const { source, calls } = sourceOf({ points: [point], grid: [nwsAnswer([])], openMeteo: [openMeteoAnswer([])] })

    await run({ source }, service => service.hours({ latitudeDegrees: 33.456789, longitudeDegrees: -112.076543, elevationMeters: 331 }, midnight + 3 * hour, midnight + 5 * hour))

    expect(calls.addresses[0]).toBe('https://api.weather.gov/points/33.4568,-112.0765')
    expect(calls.addresses[1]).toBe('https://api.weather.gov/gridpoints/TST/10,20')
    expect(calls.addresses[2]).toContain('latitude=33.4568&longitude=-112.0765')
    expect(calls.addresses.join(' ')).not.toContain('331')
  })

  it('looks the grid point up once, and not again on later refreshes', async () => {
    const { source, calls } = sourceOf({ points: [point], grid: [nwsAnswer([{ validTime: '2026-11-21T03:00:00+00:00/PT6H', value: 20 }])], openMeteo: [openMeteoAnswer([])] })

    await run({ source }, (service, clock) =>
      Effect.gen(function* () {
        yield* service.hours(phoenix, midnight + 3 * hour, midnight + 8 * hour)
        yield* clock.adjust(Duration.minutes(settings.refreshMinutes + 1))
        yield* service.hours(phoenix, midnight + 3 * hour, midnight + 8 * hour)
        yield* Effect.yieldNow
      }),
    )

    expect(calls.addresses.filter(address => address.includes('/points/'))).toHaveLength(1)
    expect(calls.addresses.filter(address => address.includes('/gridpoints/'))).toHaveLength(2)
  })

  it('retries a failed grid lookup after the retry time, not before, and not on every request', async () => {
    const { source, calls } = sourceOf({
      points: [new Error('HTTP 503'), point],
      grid: [nwsAnswer([{ validTime: '2026-11-21T03:00:00+00:00/PT6H', value: 20 }])],
      openMeteo: [openMeteoAnswer([[3, 55]])],
    })
    const reports: Array<string> = []

    const [failed, early, retried] = await run(
      { source },
      (service, clock) =>
        Effect.gen(function* () {
          const first = yield* service.hours(phoenix, midnight + 3 * hour, midnight + 5 * hour)
          yield* clock.adjust(Duration.minutes(settings.retryMinutes - 1))
          const second = yield* service.hours(phoenix, midnight + 3 * hour, midnight + 5 * hour)
          yield* clock.adjust(Duration.minutes(2))
          yield* service.hours(phoenix, midnight + 3 * hour, midnight + 5 * hour)
          yield* Effect.yieldNow
          const third = yield* service.hours(phoenix, midnight + 3 * hour, midnight + 5 * hour)

          return [first, second, third]
        }),
      reports,
    )

    expect(failed!.nws.failing).toBe(true)
    expect(hoursOf(failed!)[0]).toEqual([3, 55, 'open-meteo'])
    expect(early!.nws.failing).toBe(true)
    expect(calls.addresses.filter(address => address.includes('/points/'))).toHaveLength(2)
    expect(retried!.nws).toEqual({ ageSeconds: 0, failing: false })
    expect(hoursOf(retried!)[0]).toEqual([3, 20, 'nws'])
    expect(reports).toEqual(['forecast from nws unavailable: HTTP 503', 'forecast from nws is back'])
  })

  it('keeps the last answer for the same site when a refresh fails, and says how old it is', async () => {
    const { source } = sourceOf({
      points: [point],
      grid: [nwsAnswer([{ validTime: '2026-11-21T03:00:00+00:00/PT6H', value: 20 }]), new Error('timed out')],
      openMeteo: [openMeteoAnswer([])],
    })
    const reports: Array<string> = []

    const answer = await run(
      { source },
      (service, clock) =>
        Effect.gen(function* () {
          yield* service.hours(phoenix, midnight + 3 * hour, midnight + 8 * hour)
          yield* clock.adjust(Duration.minutes(settings.refreshMinutes + 5))
          yield* service.hours(phoenix, midnight + 3 * hour, midnight + 8 * hour)
          yield* Effect.yieldNow

          return yield* service.hours(phoenix, midnight + 3 * hour, midnight + 8 * hour)
        }),
      reports,
    )

    expect(hoursOf(answer).map(found => found[1])).toEqual([20, 20, 20, 20, 20])
    expect(answer.nws).toEqual({ ageSeconds: (settings.refreshMinutes + 5) * 60, failing: true })
    expect(reports).toEqual(['forecast from nws unavailable: timed out'])
  })

  it('does not show another site the last answer', async () => {
    const { source } = sourceOf({
      points: [point],
      grid: [nwsAnswer([{ validTime: '2026-11-21T03:00:00+00:00/PT6H', value: 20 }]), new Error('HTTP 500')],
      openMeteo: [new Error('HTTP 500')],
    })

    const answer = await run({ source }, service =>
      Effect.gen(function* () {
        yield* service.hours(phoenix, midnight + 3 * hour, midnight + 8 * hour)

        return yield* service.hours(elsewhere, midnight + 3 * hour, midnight + 8 * hour)
      }),
    )

    expect(hoursOf(answer).map(found => found[2])).toEqual([null, null, null, null, null])
    expect(answer.nws.ageSeconds).toBeNull()
  })

  it('answers unknown for every hour when neither source has answered, without a source age', async () => {
    const { source } = sourceOf({ points: [new Error('HTTP 404')], grid: [null], openMeteo: [new Error('could not be reached')] })

    const answer = await run({ source }, service => service.hours(phoenix, midnight + 3 * hour, midnight + 6 * hour))

    expect(hoursOf(answer)).toEqual([[3, null, null], [4, null, null], [5, null, null]])
    expect(answer).toMatchObject({ nws: { ageSeconds: null, failing: true }, openMeteo: { ageSeconds: null, failing: true } })
  })

  it('treats an answer in the wrong form as a failure, keeping what it had', async () => {
    const { source } = sourceOf({ points: [point], grid: [{ properties: { skyCover: { values: [{ validTime: 'soon', value: 3 }] } } }], openMeteo: [openMeteoAnswer([[3, 12]])] })
    const reports: Array<string> = []

    const answer = await run({ source }, service => service.hours(phoenix, midnight + 3 * hour, midnight + 4 * hour), reports)

    expect(hoursOf(answer)).toEqual([[3, 12, 'open-meteo']])
    expect(reports).toEqual(['forecast from nws unavailable: the answer was not in the form expected'])
  })

  it('sends only the User-Agent and logs nothing with a position in it', async () => {
    const { source } = sourceOf({ points: [new Error('HTTP 500')], grid: [null], openMeteo: [new Error('timed out')] })
    const reports: Array<string> = []

    await run({ source }, service => service.hours(phoenix, midnight + 3 * hour, midnight + 4 * hour), reports)

    expect(settings.userAgent).toBe('vela')
    expect(reports.join(' ')).not.toMatch(/33\.|112\./)
  })
})
