import { afterEach, describe, expect, it } from 'vitest'
import { buildSimulator } from './service.js'
import { SimulatorRuntime } from './runtime.js'
import { cameraPose } from './mount.js'
import { imageWidth, imageHeight } from './optics.js'
import { renderSky } from './sky.js'

const apps: ReturnType<typeof buildSimulator>[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()))
})

async function setup() {
  let time = 0
  const stars = [{ raDegrees: 30, decDegrees: 60, magnitude: 7 }]
  const app = buildSimulator({ stars, now: () => time })
  apps.push(app)
  await app.inject({ method: 'PUT', url: '/simulator/camera', payload: { resolution: 'fast' } })

  const get = async (device: string, member: string) =>
    (await app.inject(`/api/v1/${device}/0/${member}`)).json()

  const put = async (device: string, member: string, params: Record<string, string>) =>
    (
      await app.inject({
        method: 'PUT',
        url: `/api/v1/${device}/0/${member}`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams(params).toString(),
      })
    ).json()

  return {
    app,
    stars,
    get,
    put,
    advance: (ms: number) => {
      time += ms
    },
  }
}

describe('simulator Alpaca boundary', () => {
  it('preserves scalar parsing and rejects ambiguous parameters before changing connection state', async () => {
    const { app, get, put } = await setup()

    for (const payload of [
      { Connected: true, connected: false },
      { Connected: [true] },
      { Connected: 1 },
      [true],
    ]) {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/camera/0/connected',
        payload,
      })

      expect(response.json().ErrorNumber).toBe(0x401)
      expect((await get('camera', 'connected')).Value).toBe(false)
    }

    const duplicate = await app.inject({
      method: 'PUT',
      url: '/api/v1/camera/0/connected',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'Connected=true&connected=false',
    })

    expect(duplicate.json().ErrorNumber).toBe(0x401)
    expect((await get('camera', 'connected')).Value).toBe(false)
    expect(
      (await put('camera', 'connected', { Connected: 'TRUE', ClientTransactionID: '+4.2e1' }))
        .ClientTransactionID,
    ).toBe(42)
    expect((await get('camera', 'connected')).Value).toBe(true)

    for (const duration of ['', ' ', '0x1', 'Infinity', 'true']) {
      expect(
        (await put('camera', 'startexposure', { Duration: duration, Light: 'true' })).ErrorNumber,
      ).toBe(0x401)
      expect((await get('camera', 'camerastate')).Value).toBe(0)
    }
  })

  it('discovers its two cameras and shared telescope, validates writes, and reports disconnected state', async () => {
    const { app, get, put } = await setup()
    const devices = (await app.inject('/management/v1/configureddevices')).json().Value
    expect(
      devices.map((device: { DeviceType: string; DeviceNumber: number }) => [
        device.DeviceType,
        device.DeviceNumber,
      ]),
    ).toEqual([
      ['Camera', 0],
      ['Camera', 1],
      ['Telescope', 0],
    ])
    expect((await get('camera', 'camerastate')).ErrorNumber).toBe(0x407)
    expect((await put('camera', 'connected', { Connected: 'maybe' })).ErrorNumber).toBe(0x401)
    expect(
      await put('camera', 'connected', { Connected: 'true', ClientTransactionID: '42' }),
    ).toMatchObject({ ErrorNumber: 0, ClientTransactionID: 42 })
    expect((await get('camera', 'connected')).Value).toBe(true)
    expect(
      (await put('camera', 'startexposure', { Duration: 'NaN', Light: 'true' })).ErrorNumber,
    ).toBe(0x401)
    expect((await put('camera', 'numx', { NumX: '200' })).ErrorNumber).toBe(0x401)
    expect(
      (await put('camera', 'startexposure', { Duration: '-1', Light: 'true' })).ErrorNumber,
    ).toBe(0x401)
    expect((await get('camera', 'stopexposure')).ErrorNumber).toBe(0x400)
    expect((await put('camera', 'connected', { Connected: 'false' })).ErrorNumber).toBe(0)
    expect((await get('camera', 'imagearray')).ErrorNumber).toBe(0x407)
  })

  it('waits for completion and transfers actual rendered pixels in Alpaca X/Y order', async () => {
    const { app, stars, get, put, advance } = await setup()
    await app.inject({ method: 'POST', url: '/simulator/reset', payload: { preset: 'aligned' } })
    await put('camera', 'connected', { Connected: 'true' })
    expect(
      (await put('camera', 'startexposure', { Duration: '2', Light: 'true' })).ErrorNumber,
    ).toBe(0)
    expect((await get('camera', 'imageready')).Value).toBe(false)
    expect((await get('camera', 'camerastate')).Value).toBe(2)
    expect((await get('camera', 'imagearray')).ErrorNumber).toBe(0x40b)
    advance(1999)
    expect((await get('camera', 'imageready')).Value).toBe(false)
    advance(1)
    expect((await get('camera', 'imageready')).Value).toBe(true)
    expect((await get('camera', 'lastexposureduration')).Value).toBe(2)
    expect((await get('camera', 'lastexposurestarttime')).Value).toMatch(
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/,
    )
    const image = await get('camera', 'imagearray')
    expect(image).toMatchObject({ Type: 2, Rank: 2, ErrorNumber: 0 })
    expect(image.Value.length).toBe(imageWidth)
    expect(image.Value[0].length).toBe(imageHeight)

    const expected = renderSky(
      stars,
      cameraPose({
        latitudeDegrees: 40,
        altitudeErrorDegrees: 0,
        azimuthErrorDegrees: 0,
        raAxisDegrees: 30,
        declinationDegrees: 60,
        elapsedSeconds: 0,
        tracking: true,
      }),
      { width: imageWidth, height: imageHeight, fieldHeightDegrees: 3, seed: 1 },
    )

    for (const [x, y] of [
      [0, 0],
      [781, 522],
      [899, 1000],
      [1561, 1043],
    ]) {
      expect(image.Value[x!][y!]).toBe(expected[y! * imageWidth + x!]!)
    }

    expect(image.Value[781][522]).toBeGreaterThan(1000)
    await put('camera', 'startexposure', { Duration: '100', Light: 'true' })
    expect((await get('camera', 'imageready')).Value).toBe(false)
    await put('camera', 'abortexposure', {})
    advance(100000)
    expect((await get('camera', 'imageready')).Value).toBe(false)
    expect((await get('camera', 'imagearray')).ErrorNumber).toBe(0x40b)
  })

  it('rejects busy adjustments, resets pending images, and validates simulator controls', async () => {
    const { app, get, put, advance } = await setup()
    await put('camera', 'connected', { Connected: 'true' })
    await put('camera', 'startexposure', { Duration: '10', Light: 'true' })
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/simulator/adjust',
          payload: { altitudeArcsec: 0, azimuthArcsec: 0 },
        })
      ).statusCode,
    ).toBe(409)

    const reset = await app.inject({
      method: 'POST',
      url: '/simulator/reset',
      payload: { preset: 'near-aligned' },
    })

    expect(reset.json()).toMatchObject({
      altitudeArcsec: 12,
      azimuthArcsec: -9,
      cameraConnected: true,
      cameraActivity: 'idle',
      imageReady: false,
    })
    advance(20000)
    expect((await get('camera', 'imageready')).Value).toBe(false)
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/simulator/adjust',
          payload: { altitudeArcsec: 9, azimuthArcsec: -4 },
        })
      ).json(),
    ).toMatchObject({ altitudeArcsec: 9, azimuthArcsec: -4 })
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/simulator/adjust',
          payload: { altitudeArcsec: 20000, azimuthArcsec: 0 },
        })
      ).statusCode,
    ).toBe(400)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/simulator/reset',
          payload: { preset: 'aligned' },
          headers: { origin: 'https://untrusted.example' },
        })
      ).statusCode,
    ).toBe(400)
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/simulator/camera',
          payload: { obscured: 'true' },
        })
      ).statusCode,
    ).toBe(400)
  })

  it('moves RA over elapsed time, continues beyond the old catalog patch and refuses unsupported axes', async () => {
    const { app, get, put, advance } = await setup()
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
    expect((await app.inject('/simulator/state')).json().raAxisDegrees).toBeCloseTo(
      state.raAxisDegrees,
    )
    await put('telescope', 'moveaxis', { Axis: '0', Rate: '1.5' })
    advance(100000)
    const moving = (await app.inject('/simulator/state')).json()
    expect(moving.raAxisDegrees).toBeGreaterThan(185)
    expect(moving.raRateDegreesPerSecond).toBe(1.5)
    await put('telescope', 'abortslew', {})
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

it('restores tracking-off after an explicit stop and refuses exposures after drifting beyond catalog coverage', () => {
  let now = 0
  const runtime = new SimulatorRuntime([], () => now)
  runtime.setTracking(false)
  runtime.move(1.5)
  now = 20000
  runtime.stop()
  expect(runtime.state()).toMatchObject({ tracking: false, raRateDegreesPerSecond: 0 })
  now = 20000000
  expect(() => runtime.startExposure(1, true)).toThrow('outside the supported catalog patch')
})

it('cover changes during exposure apply to the next frame while pending pixels retain their snapshot', async () => {
  const { app, get, put, advance } = await setup()
  await app.inject({ method: 'POST', url: '/simulator/reset', payload: { preset: 'aligned' } })
  await put('camera', 'connected', { Connected: 'true' })
  await put('camera', 'startexposure', { Duration: '1', Light: 'true' })
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: '/simulator/camera',
        payload: { obscured: true },
      })
    ).statusCode,
  ).toBe(200)
  advance(1000)
  expect((await get('camera', 'imagearray')).Value[781][522]).toBeGreaterThan(1000)
  await put('camera', 'startexposure', { Duration: '0', Light: 'true' })
  expect((await get('camera', 'imagearray')).Value[781][522]).toBeLessThan(507)
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

it('declares J2000 and handles asynchronous slews, invalid coordinates and cancellation', async () => {
  const { get, put, advance } = await setup()
  await put('telescope', 'connected', { Connected: 'true' })
  expect((await get('telescope', 'equatorialsystem')).Value).toBe(2)
  expect((await get('telescope', 'canslewasync')).Value).toBe(true)
  expect((await get('telescope', 'sitelongitude')).Value).toBe(-75)
  expect((await get('telescope', 'siteelevation')).Value).toBe(0)
  expect((await get('telescope', 'rightascension')).Value).toBe(2)
  expect((await get('telescope', 'declination')).Value).toBe(60)
  await put('telescope', 'tracking', { Tracking: 'false' })
  expect(
    (await put('telescope', 'slewtocoordinatesasync', { RightAscension: '6', Declination: '0' }))
      .ErrorNumber,
  ).toBe(0x40b)
  expect((await get('telescope', 'slewing')).Value).toBe(false)
  await put('telescope', 'tracking', { Tracking: 'true' })

  for (const [ra, dec] of [
    ['24', '0'],
    ['-1', '0'],
    ['1', '91'],
    ['1', 'NaN'],
  ]) {
    expect(
      (await put('telescope', 'slewtocoordinatesasync', { RightAscension: ra!, Declination: dec! }))
        .ErrorNumber,
    ).toBe(0x401)
  }

  expect(
    (await put('telescope', 'slewtocoordinatesasync', { RightAscension: '6', Declination: '0' }))
      .ErrorNumber,
  ).toBe(0)
  expect((await get('telescope', 'slewing')).Value).toBe(true)
  expect((await get('telescope', 'tracking')).Value).toBe(true)
  advance(1000)
  expect((await get('telescope', 'rightascension')).Value).toBeCloseTo(4)
  expect((await get('telescope', 'declination')).Value).toBeCloseTo(30)
  await put('telescope', 'abortslew', {})
  advance(10000)
  expect((await get('telescope', 'rightascension')).Value).toBeCloseTo(4)
  expect((await get('telescope', 'slewing')).Value).toBe(false)
})

it('reports coarser fast pixels for the same physical sensor', async () => {
  const { app, get, put } = await setup()
  await put('camera', 'connected', { Connected: 'true' })
  expect((await get('camera', 'pixelsizex')).Value).toBe(15.04)
  expect((await get('camera', 'cameraxsize')).Value).toBe(1562)
  await app.inject({ method: 'PUT', url: '/simulator/camera', payload: { resolution: 'full' } })
  expect((await get('camera', 'pixelsizex')).Value).toBe(3.76)
  expect((await get('camera', 'cameraxsize')).Value).toBe(6248)
})

it('starts both cameras at full resolution and reports native pixel geometry', async () => {
  const app = buildSimulator({ stars: [] })
  apps.push(app)
  const state = (await app.inject('/simulator/state')).json()
  expect(
    state.cameras.map((camera: { resolution: string; width: number; height: number }) => [
      camera.resolution,
      camera.width,
      camera.height,
    ]),
  ).toEqual([
    ['full', 6248, 4176],
    ['full', 6248, 4176],
  ])

  for (const number of [0, 1]) {
    await app.inject({
      method: 'PUT',
      url: `/api/v1/camera/${number}/connected`,
      payload: { Connected: true },
    })
    expect((await app.inject(`/api/v1/camera/${number}/pixelsizex`)).json().Value).toBe(3.76)
  }
})
