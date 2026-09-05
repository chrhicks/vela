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
    expect(frame.pixels.length).toBe(1600 * 1200)
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
