import { afterEach, describe, expect, it } from 'vitest'
import { buildSimulator } from './service.js'
import { SimulatorRuntime } from './runtime.js'
import { cameraPose } from './mount.js'
import { renderSky } from './sky.js'

const apps: ReturnType<typeof buildSimulator>[] = []
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())) })
function setup() {
  let time = 0
  const stars = [{ raDegrees: 30, decDegrees: 60, magnitude: 7 }]
  const app = buildSimulator({ stars, now: () => time })
  apps.push(app)
  const get = async (device: string, member: string) => (await app.inject(`/api/v1/${device}/0/${member}`)).json()
  const put = async (device: string, member: string, params: Record<string, string>) => (await app.inject({ method: 'PUT', url: `/api/v1/${device}/0/${member}`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams(params).toString() })).json()
  return { app, stars, get, put, advance: (ms: number) => { time += ms } }
}

describe('simulator Alpaca boundary', () => {
  it('discovers only its camera and telescope, validates writes, and reports disconnected state', async () => {
    const { app, get, put } = setup()
    const devices = (await app.inject('/management/v1/configureddevices')).json().Value
    expect(devices.map((device: { DeviceType: string; DeviceNumber: number }) => [device.DeviceType, device.DeviceNumber])).toEqual([['Camera', 0], ['Telescope', 0]])
    expect((await get('camera', 'camerastate')).ErrorNumber).toBe(0x407)
    expect((await put('camera', 'connected', { Connected: 'maybe' })).ErrorNumber).toBe(0x401)
    expect(await put('camera', 'connected', { Connected: 'true', ClientTransactionID: '42' })).toMatchObject({ ErrorNumber: 0, ClientTransactionID: 42 })
    expect((await get('camera', 'connected')).Value).toBe(true)
    expect((await put('camera', 'startexposure', { Duration: 'NaN', Light: 'true' })).ErrorNumber).toBe(0x401)
    expect((await put('camera', 'numx', { NumX: '200' })).ErrorNumber).toBe(0x401)
    expect((await put('camera', 'startexposure', { Duration: '-1', Light: 'true' })).ErrorNumber).toBe(0x401)
    expect((await get('camera', 'stopexposure')).ErrorNumber).toBe(0x400)
    expect((await put('camera', 'connected', { Connected: 'false' })).ErrorNumber).toBe(0)
    expect((await get('camera', 'imagearray')).ErrorNumber).toBe(0x407)
  })

  it('waits for completion and transfers actual rendered pixels in Alpaca X/Y order', async () => {
    const { app, stars, get, put, advance } = setup()
    await app.inject({ method: 'POST', url: '/simulator/reset', payload: { preset: 'aligned' } })
    await put('camera', 'connected', { Connected: 'true' })
    expect((await put('camera', 'startexposure', { Duration: '2', Light: 'true' })).ErrorNumber).toBe(0)
    expect((await get('camera', 'imageready')).Value).toBe(false)
    expect((await get('camera', 'camerastate')).Value).toBe(2)
    expect((await get('camera', 'imagearray')).ErrorNumber).toBe(0x40b)
    advance(1999)
    expect((await get('camera', 'imageready')).Value).toBe(false)
    advance(1)
    expect((await get('camera', 'imageready')).Value).toBe(true)
    expect((await get('camera', 'lastexposureduration')).Value).toBe(2)
    expect((await get('camera', 'lastexposurestarttime')).Value).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/)
    const image = await get('camera', 'imagearray')
    expect(image).toMatchObject({ Type: 2, Rank: 2, ErrorNumber: 0 })
    expect(image.Value.length).toBe(1600)
    expect(image.Value[0].length).toBe(1200)
    const expected = renderSky(stars, cameraPose({ latitudeDegrees: 40, altitudeErrorDegrees: 0,
      azimuthErrorDegrees: 0, raAxisDegrees: 30, declinationDegrees: 60, elapsedSeconds: 0, tracking: true }),
    { width: 1600, height: 1200, fieldHeightDegrees: 3, seed: 1 })
    for (const [x, y] of [[0, 0], [800, 600], [899, 1000], [1599, 1199]]) {
      expect(image.Value[x!][y!]).toBe(expected[y! * 1600 + x!]!)
    }
    expect(image.Value[800][600]).toBeGreaterThan(1000)
    await put('camera', 'startexposure', { Duration: '100', Light: 'true' })
    expect((await get('camera', 'imageready')).Value).toBe(false)
    await put('camera', 'abortexposure', {})
    advance(100000)
    expect((await get('camera', 'imageready')).Value).toBe(false)
    expect((await get('camera', 'imagearray')).ErrorNumber).toBe(0x40b)
  })

  it('rejects busy adjustments, resets pending images, and validates simulator controls', async () => {
    const { app, get, put, advance } = setup()
    await put('camera', 'connected', { Connected: 'true' })
    await put('camera', 'startexposure', { Duration: '10', Light: 'true' })
    expect((await app.inject({ method: 'PUT', url: '/simulator/adjust', payload: { altitudeArcsec: 0, azimuthArcsec: 0 } })).statusCode).toBe(409)
    const reset = await app.inject({ method: 'POST', url: '/simulator/reset', payload: { preset: 'near-aligned' } })
    expect(reset.json()).toMatchObject({ altitudeArcsec: 12, azimuthArcsec: -9, cameraConnected: true, cameraActivity: 'idle', imageReady: false })
    advance(20000)
    expect((await get('camera', 'imageready')).Value).toBe(false)
    expect((await app.inject({ method: 'PUT', url: '/simulator/adjust', payload: { altitudeArcsec: 9, azimuthArcsec: -4 } })).json()).toMatchObject({ altitudeArcsec: 9, azimuthArcsec: -4 })
    expect((await app.inject({ method: 'PUT', url: '/simulator/adjust', payload: { altitudeArcsec: 20000, azimuthArcsec: 0 } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/simulator/reset', payload: { preset: 'aligned' }, headers: { origin: 'https://untrusted.example' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'PUT', url: '/simulator/camera', payload: { obscured: 'true' } })).statusCode).toBe(400)
  })

  it('moves RA over elapsed time, stops at catalog coverage and refuses unsupported axes', async () => {
    const { app, get, put, advance } = setup()
    await put('telescope', 'connected', { Connected: 'true' })
    expect((await get('telescope', 'canmoveaxis?Axis=1')).Value).toBe(false)
    expect((await get('telescope', 'axisrates?Axis=1')).Value).toEqual([])
    expect((await put('telescope', 'moveaxis', { Axis: '3', Rate: '1' })).ErrorNumber).toBe(0x401)
    expect((await put('telescope', 'moveaxis', { Axis: '1', Rate: '1' })).ErrorNumber).toBe(0x400)
    expect((await put('telescope', 'moveaxis', { Axis: '0', Rate: '2' })).ErrorNumber).toBe(0x401)
    await put('telescope', 'moveaxis', { Axis: '0', Rate: '1' })
    advance(5000)
    const state = (await app.inject('/simulator/state')).json()
    expect(state.raAxisDegrees).toBeGreaterThan(35)
    expect(state.raAxisDegrees).toBeLessThan(35.1)
    expect((await get('telescope', 'tracking')).Value).toBe(false)
    await put('telescope', 'abortslew', {})
    expect((await get('telescope', 'tracking')).Value).toBe(true)
    advance(5000)
    expect((await app.inject('/simulator/state')).json().raAxisDegrees).toBeCloseTo(state.raAxisDegrees)
    await put('telescope', 'moveaxis', { Axis: '0', Rate: '1.5' })
    advance(100000)
    expect((await app.inject('/simulator/state')).json()).toMatchObject({ raAxisDegrees: 50, raRateDegreesPerSecond: 0 })
    expect((await put('telescope', 'moveaxis', { Axis: '0', Rate: '1' })).ErrorNumber).toBe(0x40b)
  })
})

it('tracking changes preserve orientation and monotonic time ignores a backwards clock', () => {
  let now = 0
  const runtime = new SimulatorRuntime([], () => now)
  now = 100000
  const before = runtime.state()
  runtime.setTracking(false)
  expect(runtime.state().rightAscensionHours).toBe(before.rightAscensionHours)
  now += 1000
  const drifted = runtime.state()
  expect(drifted.rightAscensionHours).toBeGreaterThan(before.rightAscensionHours)
  runtime.setTracking(true)
  expect(runtime.state().rightAscensionHours).toBe(drifted.rightAscensionHours)
  now -= 500
  expect(runtime.state().rightAscensionHours).toBe(drifted.rightAscensionHours)
})

it('restores tracking-off after a boundary stop and refuses exposures after drifting beyond catalog coverage', () => {
  let now = 0
  const runtime = new SimulatorRuntime([], () => now)
  runtime.setTracking(false)
  runtime.move(1.5)
  now = 20000
  expect(runtime.state()).toMatchObject({ tracking: false, raRateDegreesPerSecond: 0 })
  now = 20000000
  expect(() => runtime.startExposure(1, true)).toThrow('outside the supported catalog patch')
})

it('cover changes during exposure apply to the next frame while pending pixels retain their snapshot', async () => {
  const { app, get, put, advance } = setup()
  await app.inject({ method: 'POST', url: '/simulator/reset', payload: { preset: 'aligned' } })
  await put('camera', 'connected', { Connected: 'true' })
  await put('camera', 'startexposure', { Duration: '1', Light: 'true' })
  expect((await app.inject({ method: 'PUT', url: '/simulator/camera', payload: { obscured: true } })).statusCode).toBe(200)
  advance(1000)
  expect((await get('camera', 'imagearray')).Value[800][600]).toBeGreaterThan(1000)
  await put('camera', 'startexposure', { Duration: '0', Light: 'true' })
  expect((await get('camera', 'imagearray')).Value[800][600]).toBeLessThan(507)
})

it('moves back from a drifted field without jumping to a catalog boundary', () => {
  let now = 0
  const runtime = new SimulatorRuntime([], () => now)
  runtime.setTracking(false)
  now = 6000000
  const drifted = runtime.state().raAxisDegrees
  expect(drifted).toBeGreaterThan(50)
  runtime.move(-1)
  now += 1000
  const moved = runtime.state().raAxisDegrees
  expect(drifted - moved).toBeGreaterThan(0.99)
  expect(drifted - moved).toBeLessThan(1)
})
