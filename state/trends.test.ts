import { describe, expect, it } from 'vitest'
import { noTrends, type Trends } from './trends.ts'
import { entry, foldRig, frameMeasured, runStarted } from './testing.ts'
import type { Entry } from './entry.ts'
import type { RigState } from './rig.ts'

const reported = (device: string, property: string, elements: Readonly<Record<string, number>>, at: number, type = 'set') => entry('wire', at, { dir: 'in', device, type, property, state: 'Ok', elements })

const guideStep = (at: number, ra: number, dec: number) => entry('phd2.GuideStep', at, { Event: 'GuideStep', RADistanceRaw: ra, DECDistanceRaw: dec, AvgDist: 0.2 })

const reduce = (entries: ReadonlyArray<Entry>): Trends => foldRig(entries).trends

const then = (before: RigState, entries: ReadonlyArray<Entry>): Trends => foldRig(entries, before).trends

describe('trends', () => {
  it('keeps a point per measured frame, guide step and weather report, in the chart shape, and when the guide star was lost', () => {
    const state = reduce([
      runStarted('r1', 100),
      frameMeasured('m31_001.fits', 200, { hfdPixels: 2.9, stars: 846 }),
      guideStep(210, 0.18, -0.05),
      entry('phd2.StarLost', 215, { Event: 'StarLost', Status: 'Star lost - low SNR', ErrorCode: 2 }),
      reported('box', 'WEATHER_PARAMETERS', { WEATHER_TEMPERATURE: 9.1, WEATHER_HUMIDITY: 74, WEATHER_DEWPOINT: 4.6 }, 220),
      reported('focuser', 'FOCUS_TEMPERATURE', { TEMPERATURE: 11 }, 230),
      reported('box', 'DEW_DUTY_CYCLES', { DEW_CHANNEL_1: 60, DEW_CHANNEL_2: 40 }, 240),
    ])

    expect(state).toEqual({
      target: 'M 31',
      since: 100,
      sequence: 'M-31_light',
      hfd: [{ x: 200, y: 2.9 }],
      stars: [{ x: 200, y: 846 }],
      guideRa: [{ x: 210, y: 0.18 }],
      guideDec: [{ x: 210, y: -0.05 }],
      guideLost: [215],
      airTemperature: [{ x: 220, y: 9.1 }],
      focuserTemperature: [{ x: 230, y: 11 }],
      humidity: [{ x: 220, y: 74 }],
      dewHeaters: { DEW_CHANNEL_1: [{ x: 240, y: 60 }], DEW_CHANNEL_2: [{ x: 240, y: 40 }] },
    })
  })

  it("leaves out the power box's all-zero weather update from before its first reading", () => {
    expect(reduce([reported('box', 'WEATHER_PARAMETERS', { WEATHER_TEMPERATURE: 0, WEATHER_HUMIDITY: 0, WEATHER_DEWPOINT: 0 }, 1)])).toEqual(noTrends)
    expect(reduce([reported('box', 'WEATHER_PARAMETERS', { WEATHER_TEMPERATURE: 0, WEATHER_HUMIDITY: 92, WEATHER_DEWPOINT: -1.2 }, 1)]).airTemperature).toEqual([{ x: 1, y: 0 }])
  })

  it('leaves out a definition, whose values are placeholders, and a frame with no stars found', () => {
    const state = reduce([reported('box', 'WEATHER_PARAMETERS', { WEATHER_TEMPERATURE: 9.1, WEATHER_HUMIDITY: 74, WEATHER_DEWPOINT: 4.6 }, 1, 'def'), frameMeasured('a.fits', 2, { hfdPixels: null, stars: null })])

    expect(state).toEqual(noTrends)
  })

  it('starts over when a light run starts on another target, not for the same target or for alignment, focus and centring', () => {
    const before = foldRig([runStarted('r1', 100, 'M 31'), frameMeasured('m31_001.fits', 200, {})])
    const operation = (object: string) => entry('vela.run.started', 300, { run: `op-${object}`, object, frameType: 'light', exposureSeconds: 2 })

    expect(then(before, [runStarted('r2', 300, 'M 31')])).toBe(before.trends)
    expect(then(before, [operation('polar-align'), operation('autofocus'), operation('centre')])).toBe(before.trends)
    expect(then(before, [runStarted('r3', 300, 'M 42')])).toEqual({ ...noTrends, target: 'M 42', since: 300, sequence: 'M-42_light' })
    expect(then(before, [entry('vela.run.started', 300, { run: 'd', object: 'dark', frameType: 'dark', exposureSeconds: 60, count: 20 })])).toBe(before.trends)
  })

  it('carries the last held reading into a new target, since the power box reports a dew heater only when it changes', () => {
    const before = foldRig([
      reported('box', 'DEW_DUTY_CYCLES', { DEW_CHANNEL_1: 0, DEW_CHANNEL_2: 0 }, 50),
      reported('box', 'WEATHER_PARAMETERS', { WEATHER_TEMPERATURE: 5.3, WEATHER_HUMIDITY: 62, WEATHER_DEWPOINT: -1.4 }, 60),
      reported('focuser', 'FOCUS_TEMPERATURE', { TEMPERATURE: 8 }, 70),
      runStarted('r1', 100, 'M 31'),
      frameMeasured('m31_001.fits', 200, { hfdPixels: 2.9, stars: 846 }),
      guideStep(210, 0.18, -0.05),
    ])

    expect(then(before, [runStarted('r2', 300, 'M 33')])).toEqual({
      ...noTrends,
      target: 'M 33',
      since: 300,
      sequence: 'M-33_light',
      airTemperature: [{ x: 300, y: 5.3 }],
      focuserTemperature: [{ x: 300, y: 8 }],
      humidity: [{ x: 300, y: 62 }],
      dewHeaters: { DEW_CHANNEL_1: [{ x: 300, y: 0 }], DEW_CHANNEL_2: [{ x: 300, y: 0 }] },
    })
  })

  it("keeps only the running target's frames, not a test frame or a frame of another target", () => {
    const state = reduce([
      runStarted('r1', 100, 'M 33'),
      frameMeasured('M-33_light_001.fits', 200, { hfdPixels: 4.3, stars: 864 }, '2026-11-15', 'M-33_light'),
      frameMeasured('test-frame_light_002.fits', 300, { hfdPixels: 5.5, stars: 249 }, '2026-11-15', 'test-frame_light'),
      frameMeasured('M-31_light_001.fits', 400, { hfdPixels: 2.9, stars: 846 }, '2026-11-15', 'M-31_light'),
    ])

    expect(state.hfd).toEqual([{ x: 200, y: 4.3 }])
    expect(state.stars).toEqual([{ x: 200, y: 864 }])
  })
})
