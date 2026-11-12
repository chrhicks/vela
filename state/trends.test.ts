import { describe, expect, it } from 'vitest'
import { noTrends, trends, type Trends } from './trends.ts'
import { entry, fold, frameMeasured, runStarted } from './testing.ts'

const reported = (device: string, property: string, elements: Readonly<Record<string, number>>, at: number, type = 'set') => entry('wire', at, { dir: 'in', device, type, property, state: 'Ok', elements })

const guideStep = (at: number, ra: number, dec: number) => entry('phd2.GuideStep', at, { Event: 'GuideStep', RADistanceRaw: ra, DECDistanceRaw: dec, AvgDist: 0.2 })

const reduce = (entries: Parameters<typeof fold>[2]) => fold<Trends>(trends, noTrends, entries)

describe('trends', () => {
  it('keeps a point per measured frame, guide step and weather report, in the chart shape', () => {
    const state = reduce([
      runStarted('r1', 100),
      frameMeasured('m31_001.fits', 200, { hfdPixels: 2.9, stars: 846 }),
      guideStep(210, 0.18, -0.05),
      reported('box', 'WEATHER_PARAMETERS', { WEATHER_TEMPERATURE: 9.1, WEATHER_HUMIDITY: 74, WEATHER_DEWPOINT: 4.6 }, 220),
      reported('focuser', 'FOCUS_TEMPERATURE', { TEMPERATURE: 11 }, 230),
      reported('box', 'DEW_DUTY_CYCLES', { DEW_CHANNEL_1: 60, DEW_CHANNEL_2: 40 }, 240),
    ])

    expect(state).toEqual({
      target: 'M 31',
      since: 100,
      hfd: [{ x: 200, y: 2.9 }],
      stars: [{ x: 200, y: 846 }],
      guideRa: [{ x: 210, y: 0.18 }],
      guideDec: [{ x: 210, y: -0.05 }],
      airTemperature: [{ x: 220, y: 9.1 }],
      focuserTemperature: [{ x: 230, y: 11 }],
      humidity: [{ x: 220, y: 74 }],
      dewHeaters: { DEW_CHANNEL_1: [{ x: 240, y: 60 }], DEW_CHANNEL_2: [{ x: 240, y: 40 }] },
    })
  })

  it('leaves out a definition, whose values are placeholders, and a frame with no stars found', () => {
    const state = reduce([reported('box', 'WEATHER_PARAMETERS', { WEATHER_TEMPERATURE: 0, WEATHER_HUMIDITY: 0 }, 1, 'def'), frameMeasured('a.fits', 2, { hfdPixels: null, stars: null })])

    expect(state).toEqual(noTrends)
  })

  it('starts over when a light run starts on another target, not for the same target or for alignment, focus and centring', () => {
    const before = reduce([runStarted('r1', 100, 'M 31'), frameMeasured('m31_001.fits', 200, {})])
    const operation = (object: string) => entry('vela.run.started', 300, { run: `op-${object}`, object, frameType: 'light', exposureSeconds: 2 })

    expect(fold(trends, before, [runStarted('r2', 300, 'M 31')])).toBe(before)
    expect(fold(trends, before, [operation('polar-align'), operation('autofocus'), operation('centre')])).toBe(before)
    expect(fold(trends, before, [runStarted('r3', 300, 'M 42')])).toEqual({ ...noTrends, target: 'M 42', since: 300 })
    expect(fold(trends, before, [entry('vela.run.started', 300, { run: 'd', object: 'dark', frameType: 'dark', exposureSeconds: 60, count: 20 })])).toBe(before)
  })
})
