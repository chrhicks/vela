import { Effect, Layer, Stream } from 'effect'
import { describe, expect, it } from 'vitest'
import type { RunEnding } from '../../state/entries.ts'
import { foldRig, frameMeasured, wire } from '../../state/testing.ts'
import type { CaptureRequest } from '../capture/request.ts'
import { Feed } from '../feed/feed.ts'
import { Capturing } from './camera.ts'
import { flatControls, FlatSettings, FlatsLog, type FlatTry } from './flats.ts'

const camera = foldRig([wire('primary', 'CONNECTION', { CONNECT: true, DISCONNECT: false }), wire('primary', 'CCD_CONTROLS', { Gain: 100, Offset: 50 })])

const measured = (sky: number) => frameMeasured('flat-exposure_flat_001.fits', 1, { stars: null, hfdPixels: null, elongation: null, sky, noise: 10 })

async function until(check: () => boolean) {
  while (!check()) await new Promise(resolve => setTimeout(resolve, 2))
}

function setup(skies: ReadonlyArray<number>, options: { readonly busy?: boolean; readonly ending?: RunEnding; readonly tries?: number } = {}) {
  const started: Array<CaptureRequest> = []
  const tried: Array<FlatTry> = []
  let next = 0
  const subscribe = Effect.sync(() => {
    const sky = skies[next]

    next += 1

    return { state: camera, entries: sky === undefined ? Stream.never : Stream.make(measured(sky)) }
  })
  const feed = Layer.succeed(Feed, { receive: () => Effect.void, subscribe, current: Effect.succeed(camera) })
  const capturing = Layer.succeed(Capturing, { busy: Effect.succeed(options.busy ?? false), start: (request: CaptureRequest) => Effect.sync(() => void started.push(request)), finished: Effect.succeed(options.ending ?? 'done') })
  const log = Layer.succeed(FlatsLog, { tried: (flatTry: FlatTry) => Effect.sync(() => void tried.push(flatTry)) })
  const settings = Layer.succeed(FlatSettings, { startSeconds: 0.5, lowAdu: 20000, highAdu: 30000, minSeconds: 0.000032, maxSeconds: 30, tries: options.tries ?? 8, measureSeconds: 0.05 })
  const press = (frames: number, celsius: number) =>
    Effect.runPromise(Effect.flatMap(flatControls, controls => controls.takeFlats(frames, celsius)).pipe(Effect.result, Effect.provide(Layer.mergeAll(feed, capturing, log, settings))))

  return { started, tried, press }
}

describe('Flats', () => {
  it('scales the exposure by the measured median until it is in range, then takes the set at that exposure', async () => {
    const { started, tried, press } = setup([42000, 24800])

    expect(await press(30, -10)).toMatchObject({ success: { code: 'flats', frames: 30, celsius: -10 } })
    await until(() => started.length === 3)

    expect(tried).toEqual([
      { exposureSeconds: 0.5, sky: 42000, verdict: 'trying', nextSeconds: 0.298 },
      { exposureSeconds: 0.298, sky: 24800, verdict: 'good' },
    ])
    expect(started).toEqual([
      { object: 'flat-exposure', frameType: 'flat', exposureSeconds: 0.5, count: 1, gain: 100, offset: 50, cooler: 'on', setpoint: -10, waitForSetpoint: true },
      { object: 'flat-exposure', frameType: 'flat', exposureSeconds: 0.298, count: 1, gain: 100, offset: 50, cooler: 'keep' },
      { object: 'flat', frameType: 'flat', exposureSeconds: 0.298, count: 30, gain: 100, offset: 50, cooler: 'on', setpoint: -10, waitForSetpoint: true },
    ])
  })

  it('says too dark or too bright when the next exposure would leave the allowed range, and takes no set', async () => {
    const dark = setup([300])

    await dark.press(30, -10)
    await until(() => dark.tried.length === 1)

    const bright = setup([65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535], { tries: 20 })

    await bright.press(30, -10)
    await until(() => bright.tried.at(-1)?.verdict === 'too-bright')

    expect(dark.tried).toEqual([{ exposureSeconds: 0.5, sky: 300, verdict: 'too-dark' }])
    expect(dark.started).toHaveLength(1)
    expect(bright.started.every(request => request.object === 'flat-exposure')).toBe(true)
  })

  it('gives up after the allowed number of test frames, and stops when a test frame was stopped or not measured', async () => {
    const wandering = setup([60000, 5000, 60000], { tries: 3 })

    await wandering.press(30, -10)
    await until(() => wandering.tried.length === 3)

    const stopped = setup([24000], { ending: 'stopped' })

    await stopped.press(30, -10)
    await until(() => stopped.tried.length === 1)

    const unmeasured = setup([])

    await unmeasured.press(30, -10)
    await until(() => unmeasured.tried.length === 1)

    expect(wandering.tried.map(flatTry => flatTry.verdict)).toEqual(['trying', 'trying', 'gave-up'])
    expect(wandering.started).toHaveLength(3)
    expect(stopped.tried).toEqual([{ exposureSeconds: 0.5, verdict: 'stopped' }])
    expect(unmeasured.tried).toEqual([{ exposureSeconds: 0.5, verdict: 'not-measured' }])
  })

  it('refuses while a run is capturing', async () => {
    const { started, press } = setup([], { busy: true })

    expect(await press(30, -10)).toMatchObject({ failure: { refusal: { code: 'run-active' } } })
    expect(started).toEqual([])
  })
})
