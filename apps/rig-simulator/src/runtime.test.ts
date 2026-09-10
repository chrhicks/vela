import { describe, expect, it } from 'vitest'
import { SimulatorRuntime } from './runtime.js'

describe('independent simulator cameras on a shared mount', () => {
  it('isolates exposures and disconnects while either exposure blocks mount changes', () => {
    let time = 0
    const runtime = new SimulatorRuntime([], () => time)
    runtime.connect('camera', true, 0)
    runtime.connect('camera', true, 1)
    runtime.startExposure(2, true, 0)
    runtime.startExposure(10, true, 1)
    time = 2000
    expect(runtime.cameraState(0).imageReady).toBe(true)
    expect(runtime.cameraState(1).activity).toBe('exposing')
    expect(() => runtime.adjust(0, 0)).toThrow('exposure is in progress')
    expect(() => runtime.move(1)).toThrow('exposure is in progress')
    expect(() => runtime.configureCamera(1, 'full')).toThrow('exposure is in progress')
    runtime.connect('camera', false, 0)
    expect(runtime.cameraState(1).activity).toBe('exposing')
    time = 10000
    expect(runtime.cameraState(1).imageReady).toBe(true)
    expect(runtime.cameraState(0).imageReady).toBe(false)
    runtime.adjust(0, 0)
    runtime.reset('aligned')
    expect(runtime.state().cameras.every(camera => !camera.imageReady)).toBe(true)
  })

  it('cancels in-flight rendering and never revives a discarded frame', async () => {
    const runtime = new SimulatorRuntime([], () => 0)
    runtime.configureCamera(1, 'full')
    runtime.startExposure(0, true, 1)
    const pending = runtime.frame(1)
    runtime.connect('camera', false, 1)
    await expect(pending).rejects.toThrow('discarded')
    expect(runtime.cameraState(1).imageReady).toBe(false)
    runtime.configureCamera(1, 'fast')
    runtime.startExposure(0, true, 1)
    const frame = await runtime.frame(1)
    expect(frame.pixels.length).toBe(1562 * 1044)
    runtime.reset('aligned')
    expect(() => frame.assertCurrent()).toThrow('discarded')
  })

  it('reuses a completed frame and reset restores deterministic noise', async () => {
    const runtime = new SimulatorRuntime([], () => 0)
    runtime.reset('aligned')
    runtime.startExposure(0, true, 0)
    const first = await runtime.frame(0)
    const again = await runtime.frame(0)
    expect(again.pixels).toBe(first.pixels)
    runtime.reset('aligned')
    runtime.startExposure(0, true, 0)
    const reset = await runtime.frame(0)
    expect(Buffer.from(reset.pixels.buffer).equals(Buffer.from(first.pixels.buffer))).toBe(true)
  })
})


describe('coordinate slews and all-sky exposure snapshots', () => {
  it('takes the short RA path, interpolates Dec, arrives across a clock jump and keeps tracking', () => {
    let time = 0
    const runtime = new SimulatorRuntime([], () => time)
    runtime.slewTo(23, -30)
    expect(runtime.state()).toMatchObject({ slewing: true, tracking: true, rightAscensionHours: 2, declinationDegrees: 60 })
    time = 1500
    expect(runtime.state()).toMatchObject({ rightAscensionHours: 0.5, declinationDegrees: 15 })
    time = 100000
    expect(runtime.state()).toMatchObject({ slewing: false, tracking: true, rightAscensionHours: 23, declinationDegrees: -30 })
    time += 100000
    expect(runtime.state().rightAscensionHours).toBeCloseTo(23)
  })

  it('stops or disconnects at intermediate coordinates and reset clears both joints and motion', () => {
    let time = 0
    const runtime = new SimulatorRuntime([], () => time)
    runtime.slewTo(6, 0)
    time = 1000
    runtime.stop()
    expect(runtime.state()).toMatchObject({ slewing: false, rightAscensionHours: 4, declinationDegrees: 30 })
    runtime.slewTo(6, 0)
    time += 500
    runtime.connect('telescope', false)
    time += 100000
    expect(runtime.state()).toMatchObject({ slewing: false, rightAscensionHours: 5, declinationDegrees: 15 })
    runtime.slewTo(12, -60)
    runtime.reset('aligned')
    expect(runtime.state()).toMatchObject({ slewing: false, rightAscensionHours: 2, declinationDegrees: 60 })
  })

  it('rejects equatorial slews without tracking and drifts after tracking is disabled at rest', () => {
    let time = 0
    const runtime = new SimulatorRuntime([], () => time)
    runtime.setTracking(false)
    expect(() => runtime.slewTo(6, 0)).toThrow('requires tracking')
    expect(runtime.state().slewing).toBe(false)
    runtime.setTracking(true)
    runtime.slewTo(6, 0)
    time = 2000
    runtime.setTracking(false)
    time += 10000
    const state = runtime.state()
    expect(state).toMatchObject({ slewing: false, tracking: false, declinationDegrees: 0 })
    expect(state.rightAscensionHours).toBeCloseTo(6 + 10 * 24 / 86164.0905, 10)
  })

  it('prevents either camera exposing during motion and either exposure blocking motion', () => {
    const runtime = new SimulatorRuntime([], () => 0)
    runtime.slewTo(6, 0)

    for (const number of [0, 1]) expect(() => runtime.startExposure(1, true, number)).toThrow('Stop mount movement')
    expect(() => runtime.move(1)).toThrow('Stop coordinate slew')
    expect(() => runtime.slewTo(7, 0)).toThrow('Stop mount movement')
    runtime.stop()

    for (const number of [0, 1]) {
      runtime.startExposure(10, true, number)
      expect(() => runtime.slewTo(6, 0)).toThrow('exposure is in progress')
      runtime.abortExposure(number)
    }
  })

  it('loads stars at the actual snapshotted pose while reporting nominal coordinates', async () => {
    let time = 0
    const fields: { raDegrees: number; decDegrees: number; radiusDegrees: number }[] = []

    const runtime = new SimulatorRuntime(async field => { fields.push(field);

 return [] }, () => time)

    runtime.slewTo(18.3, -13.8)
    time = 10000
    runtime.startExposure(0, true)
    const nominal = runtime.state()
    runtime.slewTo(2, 60)
    time += 10000
    await runtime.frame()
    expect(nominal.rightAscensionHours).toBeCloseTo(18.3)
    expect(fields[0]!.raDegrees).toBeCloseTo(274.5, 0)
    expect(Math.abs(fields[0]!.decDegrees + 13.8)).toBeGreaterThan(0.001)
    expect(fields[0]!.radiusDegrees).toBeGreaterThan(2.6)
  })

  it('checks fixture catalog coverage against tilted camera truth, not nominal telemetry', () => {
    let time = 0
    const runtime = new SimulatorRuntime([], () => time)
    runtime.slewTo(2, 54)
    time = 1000
    runtime.adjust(18000, 0)
    expect(runtime.state().declinationDegrees).toBe(54)
    expect(() => runtime.startExposure(0, true)).toThrow('outside the supported catalog patch')
  })

  it('aborts a held catalog load and rejects the discarded frame even if the source ignores abort', async () => {
    let release!: (stars: readonly []) => void
    let signal: AbortSignal | undefined

    const runtime = new SimulatorRuntime((_field, inputSignal) => {
      signal = inputSignal

      return new Promise(resolve => { release = resolve })
    }, () => 0)

    runtime.startExposure(0, true)
    const pending = runtime.frame()
    runtime.reset('aligned')
    expect(signal?.aborted).toBe(true)
    release([])
    await expect(pending).rejects.toThrow('discarded')
    expect(runtime.cameraState().imageReady).toBe(false)
  })
})
