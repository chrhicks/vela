import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { hoursOf, NwsGridData, nwsCover, OpenMeteoAnswer, openMeteoCover, ValidInterval } from './cover.ts'

const hour = 3_600_000
const midnight = Date.parse('2026-11-21T00:00:00Z')
const intervalOf = (text: string) => Schema.decodeUnknownSync(ValidInterval)(text)
const gridOf = (values: ReadonlyArray<{ readonly validTime: string; readonly value: number | null }>) => Schema.decodeUnknownSync(NwsGridData)({ properties: { skyCover: { values } } })

describe('an interval of hours', () => {
  it('is one hour for PT1H', () => {
    expect(hoursOf(intervalOf('2026-11-21T05:00:00+00:00/PT1H'))).toEqual([midnight + 5 * hour])
  })

  it('is each hour of PT3H', () => {
    expect(hoursOf(intervalOf('2026-11-21T05:00:00+00:00/PT3H'))).toEqual([5, 6, 7].map(h => midnight + h * hour))
  })

  it('crosses midnight', () => {
    expect(hoursOf(intervalOf('2026-11-21T22:00:00+00:00/PT4H'))).toEqual([22, 23, 24, 25].map(h => midnight + h * hour))
  })

  it('reads a start with an offset as the instant it names', () => {
    expect(hoursOf(intervalOf('2026-11-20T22:00:00-07:00/PT2H'))).toEqual([midnight + 5 * hour, midnight + 6 * hour])
  })

  it('counts days and hours together', () => {
    expect(hoursOf(intervalOf('2026-11-21T00:00:00+00:00/P1DT2H'))).toHaveLength(26)
    expect(hoursOf(intervalOf('2026-11-21T00:00:00+00:00/P2D'))).toHaveLength(48)
  })

  it('starts at the hour an interval beginning part way in falls in', () => {
    expect(hoursOf(intervalOf('2026-11-21T05:30:00+00:00/PT1H'))).toEqual([midnight + 5 * hour])
  })

  it('is refused when it is not an interval, has no length or names no real time', () => {
    for (const text of ['PT1H', '2026-11-21T05:00:00+00:00', '2026-11-21T05:00:00+00:00/P', '2026-11-21T05:00:00+00:00/PT1M', '2026-13-45T05:00:00+00:00/PT1H']) {
      expect(() => intervalOf(text)).toThrow()
    }
  })
})

describe('National Weather Service sky cover', () => {
  it('gives each hour of each interval its value, keeping 0', () => {
    const cover = nwsCover(gridOf([{ validTime: '2026-11-21T05:00:00+00:00/PT3H', value: 0 }, { validTime: '2026-11-21T08:00:00+00:00/PT1H', value: 85 }]))

    expect([...cover]).toEqual([[midnight + 5 * hour, 0], [midnight + 6 * hour, 0], [midnight + 7 * hour, 0], [midnight + 8 * hour, 85]])
  })

  it('leaves out an interval with no value', () => {
    expect(nwsCover(gridOf([{ validTime: '2026-11-21T05:00:00+00:00/PT2H', value: null }])).size).toBe(0)
  })

  it('is refused when a value is not a number', () => {
    expect(() => Schema.decodeUnknownSync(NwsGridData)({ properties: { skyCover: { values: [{ validTime: '2026-11-21T05:00:00+00:00/PT1H', value: 'clear' }] } } })).toThrow()
  })
})

describe('Open-Meteo cloud cover', () => {
  it('gives each listed hour its value, keeping 0 and leaving out null', () => {
    const answer = Schema.decodeUnknownSync(OpenMeteoAnswer)({ hourly: { time: [(midnight + 5 * hour) / 1000, (midnight + 6 * hour) / 1000, (midnight + 7 * hour) / 1000], cloud_cover: [0, null, 40] } })

    expect([...openMeteoCover(answer)]).toEqual([[midnight + 5 * hour, 0], [midnight + 7 * hour, 40]])
  })
})
