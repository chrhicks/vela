import type { ResponseFixture } from './internal/test-fixtures.js'
import { describe, expect, it } from 'vitest'
import { AlpacaFramingStoppedError, createAlpacaFraming } from './framing.js'

function observatory(requestTimeoutMs = 100) {
  interface PropertyFixtures { [operation: string]: ResponseFixture }

  const values: PropertyFixtures = {
    connected: true, name: ' Camera ', cameraxsize: 6000, cameraysize: 4000,
    pixelsizex: 3.76, pixelsizey: 3.76, binx: 2, biny: 2, numx: 2000, numy: 1500, startx: 50, starty: 100,
    rightascension: 2, declination: -20, equatorialsystem: 1,
    sitelatitude: 35, sitelongitude: -80, siteelevation: 200,
    tracking: true, slewing: false, atpark: false, canslewasync: true, cansettracking: true, canfindhome: true, athome: false,
  }

  const writes: { operation: string; parameters: URLSearchParams }[] = []
  const requests: { method: string; path: string }[] = []
  const unsupported = new Set<string>()
  const errors = new Map<string, number>()
  const transportFailures = new Set<string>()
  let started!: () => void
  const whenStarted = new Promise<void>(resolve => { started = resolve })

  const state = { loseSlew: false, loseTracking: false, stopFails: false, onSlew: () => {}, onHome: () => {}, onTracking: () => {},
    trackingDelayReads: 0, rejectTracking: false, trackingReadFails: false }

  let requestedTracking: boolean | undefined

  const fetch: typeof globalThis.fetch = async (input, init) => {
    init?.signal?.throwIfAborted()
    const path = new URL(String(input)).pathname
    requests.push({ method: init?.method ?? 'GET', path })
    const operation = path.split('/').at(-1)!
    const envelope = (Value?: ResponseFixture, ErrorNumber = 0) => Response.json({ ClientTransactionID: 0, ServerTransactionID: 1, ErrorNumber, ErrorMessage: '', Value })

    if (transportFailures.has(operation)) throw new TypeError('Device unreachable')

    if (operation === 'configureddevices') return envelope([
      { DeviceName: 'Camera', DeviceType: 'Camera', DeviceNumber: 7, UniqueID: 'camera-id' },
      { DeviceName: 'Mount', DeviceType: 'Telescope', DeviceNumber: 3, UniqueID: 'mount-id' },
    ])

    if (init?.method === 'PUT') {
      const parameters = new URLSearchParams(String(init.body))
      writes.push({ operation, parameters })

      if (operation === 'findhome') {
        values.slewing = true
        values.athome = false
        started()
        state.onHome()

        if (state.loseSlew) throw new TypeError('Response lost after homing started')
      } else if (operation === 'slewtocoordinatesasync') {
        values.slewing = true
        started()
        state.onSlew()

        if (state.loseSlew) throw new TypeError('Response lost after slew started')
      } else if (operation === 'abortslew') {
        if (state.stopFails) throw new TypeError('Abort unreachable')
        values.slewing = false
      } else if (operation === 'tracking') {
        if (state.rejectTracking) return Response.json({ ClientTransactionID: 0, ServerTransactionID: 1, ErrorNumber: 1280, ErrorMessage: 'Mount rejected tracking mode' })
        requestedTracking = parameters.get('Tracking') === 'true'

        if (!state.trackingDelayReads) values.tracking = requestedTracking
        state.onTracking()

        if (state.loseTracking) throw new TypeError('Setter response lost')
      } else throw new Error(`Unexpected write ${operation}`)

      return envelope()
    }

    if (operation === 'tracking') {
      if (state.trackingReadFails) throw new TypeError('Tracking state unavailable')

      if (requestedTracking !== undefined && state.trackingDelayReads > 0) {
        state.trackingDelayReads -= 1

        if (!state.trackingDelayReads) values.tracking = requestedTracking
      }
    }

    if (errors.has(operation)) return envelope(undefined, errors.get(operation))

    if (unsupported.has(operation)) return envelope(undefined, 1024)

    if (!(operation in values)) throw new Error(`Unexpected read ${operation}`)

    return envelope(values[operation])
  }

  const framing = createAlpacaFraming({ baseUrl: 'http://fake', fetch, requestTimeoutMs, pollIntervalMs: 1, slewTimeoutMs: 100 })

  return { framing, values, writes, requests, unsupported, errors, transportFailures, state, whenStarted }
}

const target = { telescopeId: 'mount-id', rightAscensionDegrees: 45, declinationDegrees: 25, coordinateSystem: 'topocentric' as const }

describe('framing boundary', () => {
  it('confirms home only after both motion ends and home is observed, without restoring tracking', async () => {
    const fake = observatory()
    fake.values.tracking = false
    let completed = false
    const result = fake.framing.home('mount-id').then(() => { completed = true })
    await fake.whenStarted
    fake.values.athome = true
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(completed).toBe(false)
    fake.values.athome = false
    fake.values.slewing = false
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(completed).toBe(false)
    fake.values.athome = true
    await result
    expect(fake.values.tracking).toBe(false)
    expect(fake.writes.map(write => write.operation)).toEqual(['findhome'])
  })

  it.each([{ connected: false }, { atpark: true }, { slewing: true }, { canfindhome: false }, { canfindhome: 'true' }])('rejects unavailable homing before writing %j', async changes => {
    const fake = observatory()
    Object.assign(fake.values, changes)
    await expect(fake.framing.home('mount-id')).rejects.toThrow()
    expect(fake.writes).toEqual([])
  })

  it('stops a lost homing response without replay or claiming arrival', async () => {
    const fake = observatory()
    fake.state.loseSlew = true
    await expect(fake.framing.home('mount-id')).rejects.toThrow('Unable to reach')
    expect(fake.values.slewing).toBe(false)
    expect(fake.writes.map(write => write.operation)).toEqual(['findhome', 'abortslew'])
  })

  it('cancels homing only after independent stop confirmation', async () => {
    const fake = observatory()
    const controller = new AbortController()
    const assertion = expect(fake.framing.home('mount-id', controller.signal)).rejects.toBeInstanceOf(AlpacaFramingStoppedError)
    await fake.whenStarted
    controller.abort()
    await assertion
    expect(fake.values.slewing).toBe(false)
    expect(fake.writes.map(write => write.operation)).toEqual(['findhome', 'abortslew'])
  })

  it('keeps unconfirmed homing cleanup a failure after cancellation', async () => {
    const fake = observatory()
    fake.state.stopFails = true
    const controller = new AbortController()
    const assertion = expect(fake.framing.home('mount-id', controller.signal)).rejects.toThrow('stop could not be confirmed')
    await fake.whenStarted
    controller.abort()
    await assertion
    expect(fake.values.slewing).toBe(true)
  })

  it.each([false, 'true'])('bounds missing or malformed home confirmation %j and independently stops', async athome => {
    const fake = observatory()
    fake.state.onHome = () => { Object.assign(fake.values, { slewing: false, athome }) }

    await expect(fake.framing.home('mount-id')).rejects.toThrow()
    expect(fake.writes.map(write => write.operation)).toEqual(['findhome', 'abortslew'])
  })

  it('does not issue home when already cancelled', async () => {
    const fake = observatory()
    const controller = new AbortController()
    controller.abort()
    await expect(fake.framing.home('mount-id', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fake.writes).toEqual([])
  })

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

  // ASCOM Telescope.SideOfPier and PierSide define an optional read with
  // pierUnknown=-1, pierEast=0 (normal), pierWest=1 (through the pole).
  // https://ascom-standards.org/newdocs/telescope.html#Telescope.SideOfPier
  it.each([[-1, 'unknown'], [0, 'east'], [1, 'west']] as const)('reads only the requested pointing side and normalizes %s to %s', async (sideofpier, pierSide) => {
    const fake = observatory()
    fake.values.sideofpier = sideofpier
    const ordinary = await fake.framing.telescopeStatus('mount-id')
    expect(ordinary).not.toHaveProperty('pierSide')
    expect(fake.requests.every(request => request.method === 'GET')).toBe(true)
    expect(fake.requests.some(request => request.path.endsWith('/sideofpier'))).toBe(false)
    const ordinaryRequests = fake.requests.splice(0)

    const status = await fake.framing.telescopeStatus('mount-id', undefined, { includePointingSide: true })

    expect(status).toMatchObject({ pierSide })
    expect(status).not.toHaveProperty('trackingRate')
    expect(status).not.toHaveProperty('rightAscensionRateSecondsPerSiderealSecond')
    expect(status).not.toHaveProperty('declinationRateArcsecondsPerSecond')
    expect(fake.requests).toEqual([...ordinaryRequests, { method: 'GET', path: '/api/v1/telescope/3/sideofpier' }])
    expect(fake.writes).toEqual([])
  })

  it('reads pointing side once when both options request it, retaining alignment rates', async () => {
    const fake = observatory()
    Object.assign(fake.values, { trackingrate: 2, rightascensionrate: -0.25, declinationrate: 1.5, sideofpier: 1 })
    const status = await fake.framing.telescopeStatus('mount-id', undefined, { includeAlignmentObservations: true, includePointingSide: true })
    expect(status).toMatchObject({ trackingRate: 'solar', rightAscensionRateSecondsPerSiderealSecond: -0.25, declinationRateArcsecondsPerSecond: 1.5, pierSide: 'west' })
    expect(fake.requests.filter(request => request.path.endsWith('/sideofpier'))).toEqual([{ method: 'GET', path: '/api/v1/telescope/3/sideofpier' }])
  })

  it('omits unsupported pointing side rather than substituting the unknown sentinel', async () => {
    const fake = observatory()
    fake.unsupported.add('sideofpier')
    const status = await fake.framing.telescopeStatus('mount-id', undefined, { includePointingSide: true })
    expect(status).not.toHaveProperty('pierSide')
  })

  it.each([undefined, null, '-1', -2, 2, 0.5])('rejects missing or malformed pointing side %s', async sideofpier => {
    const fake = observatory()
    fake.values.sideofpier = sideofpier
    await expect(fake.framing.telescopeStatus('mount-id', undefined, { includePointingSide: true })).rejects.toMatchObject({ reason: 'invalid-response' })
  })

  it('preserves driver and transport failures instead of omitting unavailable pointing side', async () => {
    const fake = observatory()
    fake.errors.set('sideofpier', 1280)
    await expect(fake.framing.telescopeStatus('mount-id', undefined, { includePointingSide: true })).rejects.toMatchObject({ reason: 'protocol-error', errorNumber: 1280, endpoint: '/api/v1/telescope/3/sideofpier' })
    fake.errors.clear()
    fake.transportFailures.add('sideofpier')
    await expect(fake.framing.telescopeStatus('mount-id', undefined, { includePointingSide: true })).rejects.toMatchObject({ reason: 'transport', endpoint: '/api/v1/telescope/3/sideofpier' })
  })

  it.each([0, 1, 2, 3])('normalizes alignment observations with tracking mode %s', async trackingrate => {
    const fake = observatory()
    Object.assign(fake.values, { trackingrate, rightascensionrate: -0.25, declinationrate: 1.5, sideofpier: 0 })
    const status = await fake.framing.telescopeStatus('mount-id', undefined, { includeAlignmentObservations: true })
    expect(status).toMatchObject({ trackingRate: ['sidereal', 'lunar', 'solar', 'king'][trackingrate], rightAscensionRateSecondsPerSiderealSecond: -0.25, declinationRateArcsecondsPerSecond: 1.5, pierSide: 'east' })
    expect(fake.writes).toEqual([])
  })

  it.each([[-1, 'unknown'], [1, 'west']] as const)('retains pier pointing state %s as %s', async (sideofpier, pierSide) => {
    const fake = observatory()
    Object.assign(fake.values, { trackingrate: 0, rightascensionrate: 0, declinationrate: 0, sideofpier })
    expect(await fake.framing.telescopeStatus('mount-id', undefined, { includeAlignmentObservations: true })).toMatchObject({ pierSide })
  })

  it('omits unsupported alignment observations without inventing sidereal or zero rates', async () => {
    const fake = observatory()

    for (const property of ['trackingrate', 'rightascensionrate', 'declinationrate', 'sideofpier']) fake.unsupported.add(property)
    const status = await fake.framing.telescopeStatus('mount-id', undefined, { includeAlignmentObservations: true })

    for (const property of ['trackingRate', 'rightAscensionRateSecondsPerSiderealSecond', 'declinationRateArcsecondsPerSecond', 'pierSide']) expect(status).not.toHaveProperty(property)
  })

  it.each([
    ['trackingrate', 4], ['trackingrate', 0.5], ['trackingrate', '0'],
    ['rightascensionrate', '0'], ['rightascensionrate', null],
    ['declinationrate', null], ['declinationrate', Infinity],
    ['sideofpier', 2], ['sideofpier', 0.5], ['sideofpier', '-1'],
  ])('rejects malformed alignment property %s=%s', async (property, value) => {
    const fake = observatory()
    Object.assign(fake.values, { trackingrate: 0, rightascensionrate: 0, declinationrate: 0, sideofpier: -1, [String(property)]: value })
    await expect(fake.framing.telescopeStatus('mount-id', undefined, { includeAlignmentObservations: true })).rejects.toMatchObject({ reason: 'invalid-response' })
  })

  it.each(['trackingrate', 'rightascensionrate', 'declinationrate', 'sideofpier'])('propagates a real alignment observation failure from %s, while ordinary framing does not request it', async property => {
    const fake = observatory()
    Object.assign(fake.values, { trackingrate: 0, rightascensionrate: 0, declinationrate: 0, sideofpier: -1 })
    fake.errors.set(property, 1280)
    await expect(fake.framing.telescopeStatus('mount-id')).resolves.toMatchObject({ tracking: true })
    await expect(fake.framing.telescopeStatus('mount-id', undefined, { includeAlignmentObservations: true })).rejects.toMatchObject({ reason: 'protocol-error', errorNumber: 1280 })
    expect(fake.writes).toEqual([])
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

  it.each([false, true])('observes delayed tracking without replay after a setter (lost response: %s)', async lost => {
    const fake = observatory()
    fake.state.trackingDelayReads = 3
    fake.state.loseTracking = lost
    await fake.framing.setTracking('mount-id', false)
    expect(fake.values.tracking).toBe(false)
    expect(fake.state.trackingDelayReads).toBe(0)
    expect(fake.writes.map(write => write.operation)).toEqual(['tracking'])
  })

  it('preserves a decoded tracking rejection without replay or claiming success', async () => {
    const fake = observatory()
    fake.state.rejectTracking = true
    await expect(fake.framing.setTracking('mount-id', false)).rejects.toThrow('Setter reported: Mount rejected tracking mode')
    expect(fake.values.tracking).toBe(true)
    expect(fake.writes.map(write => write.operation)).toEqual(['tracking'])
  })

  it('reports disconnection during confirmation and never repeats the setter', async () => {
    const fake = observatory()
    fake.state.onTracking = () => { fake.values.connected = false }

    await expect(fake.framing.setTracking('mount-id', false)).rejects.toThrow('Telescope disconnected during tracking confirmation')
    expect(fake.writes.map(write => write.operation)).toEqual(['tracking'])
  })

  it('preserves the setter and inspection errors when confirmation is unavailable', async () => {
    const fake = observatory()
    fake.state.loseTracking = true
    fake.state.onTracking = () => { fake.state.trackingReadFails = true }

    await expect(fake.framing.setTracking('mount-id', false)).rejects.toThrow('Unable to reach Alpaca endpoint /api/v1/telescope/3/tracking. Setter reported: Unable to reach Alpaca endpoint /api/v1/telescope/3/tracking')
    expect(fake.writes.map(write => write.operation)).toEqual(['tracking'])
  })

  it('bounds unconfirmed tracking while preserving uncertainty after cancellation', async () => {
    const fake = observatory(10)
    const controller = new AbortController()
    fake.state.trackingDelayReads = Infinity
    fake.state.onTracking = () => { controller.abort() }

    await expect(fake.framing.setTracking('mount-id', false, controller.signal)).rejects.toThrow('Requested tracking state was not observed before the confirmation deadline')
    expect(fake.values.tracking).toBe(true)
    expect(fake.writes.map(write => write.operation)).toEqual(['tracking'])
  })

  it('finishes independent confirmation after cancellation but still rejects the caller', async () => {
    const fake = observatory()
    const controller = new AbortController()
    fake.state.trackingDelayReads = 3
    fake.state.onTracking = () => { controller.abort() }

    await expect(fake.framing.setTracking('mount-id', false, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fake.values.tracking).toBe(false)
    expect(fake.state.trackingDelayReads).toBe(0)
    expect(fake.writes.map(write => write.operation)).toEqual(['tracking'])
  })

  it('does not write tracking when cancelled before the setter', async () => {
    const fake = observatory()
    const controller = new AbortController()
    controller.abort()
    await expect(fake.framing.setTracking('mount-id', false, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fake.writes).toEqual([])
  })
})
