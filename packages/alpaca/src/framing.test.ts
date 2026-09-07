import { describe, expect, it } from 'vitest'
import { AlpacaFramingStoppedError, createAlpacaFraming } from './framing.js'

function observatory() {
  const values: Record<string, unknown> = {
    connected: true, name: ' Camera ', cameraxsize: 6000, cameraysize: 4000,
    pixelsizex: 3.76, pixelsizey: 3.76, binx: 2, biny: 2, numx: 2000, numy: 1500, startx: 50, starty: 100,
    rightascension: 2, declination: -20, equatorialsystem: 1,
    sitelatitude: 35, sitelongitude: -80, siteelevation: 200,
    tracking: true, slewing: false, atpark: false, canslewasync: true, cansettracking: true,
  }
  const writes: { operation: string; parameters: URLSearchParams }[] = []
  const unsupported = new Set<string>()
  let started!: () => void
  const whenStarted = new Promise<void>(resolve => { started = resolve })
  const state = { loseSlew: false, loseTracking: false, stopFails: false, onSlew: () => {} }
  const fetch: typeof globalThis.fetch = async (input, init) => {
    init?.signal?.throwIfAborted()
    const operation = new URL(String(input)).pathname.split('/').at(-1)!
    const envelope = (Value?: unknown, ErrorNumber = 0) => Response.json({ ClientTransactionID: 0, ServerTransactionID: 1, ErrorNumber, ErrorMessage: '', Value })
    if (operation === 'configureddevices') return envelope([
      { DeviceName: 'Camera', DeviceType: 'Camera', DeviceNumber: 7, UniqueID: 'camera-id' },
      { DeviceName: 'Mount', DeviceType: 'Telescope', DeviceNumber: 3, UniqueID: 'mount-id' },
    ])
    if (init?.method === 'PUT') {
      const parameters = new URLSearchParams(String(init.body))
      writes.push({ operation, parameters })
      if (operation === 'slewtocoordinatesasync') {
        values.slewing = true
        started()
        state.onSlew()
        if (state.loseSlew) throw new TypeError('Response lost after slew started')
      } else if (operation === 'abortslew') {
        if (state.stopFails) throw new TypeError('Abort unreachable')
        values.slewing = false
      } else if (operation === 'tracking') {
        values.tracking = parameters.get('Tracking') === 'true'
        if (state.loseTracking) throw new TypeError('Setter response lost')
      } else throw new Error(`Unexpected write ${operation}`)
      return envelope()
    }
    if (unsupported.has(operation)) return envelope(undefined, 1024)
    if (!(operation in values)) throw new Error(`Unexpected read ${operation}`)
    return envelope(values[operation])
  }
  const framing = createAlpacaFraming({ baseUrl: 'http://fake', fetch, pollIntervalMs: 1, slewTimeoutMs: 100 })
  return { framing, values, writes, unsupported, state, whenStarted }
}
const target = { telescopeId: 'mount-id', rightAscensionDegrees: 45, declinationDegrees: 25, coordinateSystem: 'topocentric' as const }

describe('framing boundary', () => {
  it('reads physical sensor geometry separately from the binned subframe and verifies camera identity', async () => {
    const fake = observatory()
    await expect(fake.framing.cameraGeometry({ cameraId: 'camera-id', expectedCameraName: 'Camera' })).resolves.toEqual({
      cameraName: 'Camera', sensorWidthPixels: 6000, sensorHeightPixels: 4000, pixelWidthMicrons: 3.76, pixelHeightMicrons: 3.76,
      binX: 2, binY: 2, width: 2000, height: 1500, startX: 50, startY: 100,
    })
    await expect(fake.framing.cameraGeometry({ cameraId: 'camera-id', expectedCameraName: 'Different camera' })).rejects.toThrow('changed')
    expect(fake.writes).toEqual([])
  })

  it.each([{ numx: 0 }, { binx: 1.5 }, { pixelsizex: 0 }, { startx: -1 }, { numx: 3000, startx: 1 }])('rejects invalid or contradictory camera geometry %j', async changes => {
    const fake = observatory()
    Object.assign(fake.values, changes)
    await expect(fake.framing.cameraGeometry({ cameraId: 'camera-id' })).rejects.toThrow()
  })

  it('keeps unknown and other coordinate frames honest and omits only unsupported site values', async () => {
    const fake = observatory()
    fake.unsupported.add('equatorialsystem')
    fake.unsupported.add('siteelevation')
    const status = await fake.framing.telescopeStatus('mount-id')
    expect(status).toMatchObject({ coordinateSystem: 'unknown', rightAscensionDegrees: 30, declinationDegrees: -20, latitudeDegrees: 35, longitudeDegrees: -80, tracking: true, slewing: false, parked: false })
    expect(status).not.toHaveProperty('elevationMeters')
    expect(Number.isFinite(Date.parse(status.observedAt))).toBe(true)
    fake.unsupported.delete('equatorialsystem')
    fake.values.equatorialsystem = 0
    expect((await fake.framing.telescopeStatus('mount-id')).coordinateSystem).toBe('other')
    fake.values.sitelatitude = 91
    await expect(fake.framing.telescopeStatus('mount-id')).rejects.toThrow('sitelatitude')
  })

  it.each([{ connected: false }, { atpark: true }, { slewing: true }, { canslewasync: false }, { tracking: false }, { equatorialsystem: 0 }, { equatorialsystem: 2 }])('rejects an incompatible slew before writing %j', async changes => {
    const fake = observatory()
    Object.assign(fake.values, changes)
    await expect(fake.framing.slew(target)).rejects.toThrow()
    expect(fake.writes).toEqual([])
  })

  it('converts RA degrees to driver hours and remains pending until slewing stops', async () => {
    const fake = observatory()
    let completed = false
    const result = fake.framing.slew(target).then(() => { completed = true })
    await fake.whenStarted
    expect(completed).toBe(false)
    expect(fake.writes[0]?.parameters.get('RightAscension')).toBe('3')
    expect(fake.writes[0]?.parameters.get('Declination')).toBe('25')
    fake.values.slewing = false
    await result
    expect(completed).toBe(true)
    expect(fake.writes.map(write => write.operation)).toEqual(['slewtocoordinatesasync'])
  })

  it('stops an ambiguous movement once and reports the lost command instead of claiming arrival', async () => {
    const fake = observatory()
    fake.state.loseSlew = true
    await expect(fake.framing.slew(target)).rejects.toThrow('Unable to reach')
    expect(fake.values.slewing).toBe(false)
    expect(fake.writes.map(write => write.operation)).toEqual(['slewtocoordinatesasync', 'abortslew'])
  })

  it('cancels an active slew with an independent abort and confirmed stop', async () => {
    const fake = observatory()
    const controller = new AbortController()
    const result = fake.framing.slew(target, controller.signal)
    const assertion = expect(result).rejects.toBeInstanceOf(AlpacaFramingStoppedError)
    await fake.whenStarted
    controller.abort()
    await assertion
    expect(fake.values.slewing).toBe(false)
    expect(fake.writes.map(write => write.operation)).toEqual(['slewtocoordinatesasync', 'abortslew'])
  })

  it('does not label failed physical cleanup as cancellation', async () => {
    const fake = observatory()
    const controller = new AbortController()
    fake.state.stopFails = true
    const assertion = expect(fake.framing.slew(target, controller.signal)).rejects.toThrow('stop could not be confirmed')
    await fake.whenStarted
    controller.abort()
    await assertion
    expect(fake.values.slewing).toBe(true)
  })

  it('bounds an unfinished slew, aborts it, and reports timeout', async () => {
    const fake = observatory()
    await expect(fake.framing.slew(target)).rejects.toThrow()
    expect(fake.values.slewing).toBe(false)
    expect(fake.writes.map(write => write.operation)).toEqual(['slewtocoordinatesasync', 'abortslew'])
  })

  it('confirms a lost tracking setter by observation without replay and aborts only the telescope', async () => {
    const fake = observatory()
    fake.state.loseTracking = true
    await fake.framing.setTracking('mount-id', false)
    await fake.framing.setTracking('mount-id', false)
    fake.values.slewing = true
    await fake.framing.abortTelescope('mount-id')
    expect(fake.writes.map(write => write.operation)).toEqual(['tracking', 'abortslew'])
    expect(fake.values.slewing).toBe(false)
  })
})
