import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CaptureRetryableError, CaptureUncertainError, EquipmentError, FocuserStoppedError, type CaptureFrameType, type CaptureProvenance } from '@vela/equipment'
import { createCriaConnection } from '../src/connection.js'
import { createCriaEquipment } from '../src/equipment.js'
import type { Device } from '@cria/wire'
import { FakeCria } from './v5/fake-cria.js'

let cria: FakeCria

let connection: ReturnType<typeof createCriaConnection>

let equipment: ReturnType<typeof createCriaEquipment>

beforeEach(async () => {
  vi.useFakeTimers({ now: Date.UTC(2026, 9, 17, 3) })
  cria = new FakeCria()
  connection = createCriaConnection({ origin: cria.origin, fetch: cria.fetch })
  equipment = createCriaEquipment(connection, [
    { providerDeviceId: 'camera', id: 'camera', kind: 'camera', expectedName: 'Fake CCD' },
    { providerDeviceId: 'mount', id: 'mount', kind: 'mount', expectedName: 'ZWO AM5' },
    { providerDeviceId: 'focuser', id: 'focuser', kind: 'focuser', expectedName: 'Fake Focuser' },
  ])
  connection.start()
  await vi.advanceTimersByTimeAsync(10)
})

afterEach(async () => {
  await connection.close()
  cria.close()
  vi.useRealTimers()
})

describe('protocol 5 Promise capabilities', () => {
  it('reads named mount facts and the usable inclusive focuser window', async () => {
    expect(await equipment.framing.telescopeStatus('mount', undefined, { includeAlignmentObservations: true })).toMatchObject({
      coordinateSystem: 'topocentric', trackingRate: 'sidereal', pierSide: 'east', latitudeDegrees: 40, longitudeDegrees: -75,
    })
    expect(await equipment.focuser.status('focuser')).toEqual({ absolute: true, position: 20000, minStep: 15500, maxStep: 38000, moving: false })
    expect(await equipment.provider.inspectDevices()).toMatchObject([
      { observation: { state: 'current', commandReady: true }, telemetry: { values: { kind: 'camera', activity: 'idle' } } },
      { telemetry: { values: { kind: 'telescope', parked: false, tracking: true } } },
      { telemetry: { values: { kind: 'focuser', minStep: 15500, maxStep: 38000 } } },
    ])
  })

  describe('alignment observations on a mount whose driver cannot set a tracking rate', () => {
    function am5(readings: Partial<Extract<Device, { kind: 'mount' }>['readings']> = {}) {
      cria.deviceView = device => device.kind === 'mount'
        ? {
          ...device,
          readings: {
            ...device.readings,
            tracking: { status: 'fresh', value: false, observedAt: Date.now() },
            pierSide: { status: 'fresh', value: 'unknown', observedAt: Date.now() },
            rightAscensionRateSecondsPerSiderealSecond: { status: 'unavailable', reason: 'unsupported' },
            declinationRateArcsecondsPerSecond: { status: 'unavailable', reason: 'unsupported' },
            ...readings,
          },
        }
        : device
    }

    it('reads both offsets as zero while the mount tracks at the sidereal rate', async () => {
      am5()
      await vi.advanceTimersByTimeAsync(1000)

      expect(await equipment.framing.telescopeStatus('mount', undefined, { includeAlignmentObservations: true })).toMatchObject({
        trackingRate: 'sidereal',
        rightAscensionRateSecondsPerSiderealSecond: 0,
        declinationRateArcsecondsPerSecond: 0,
        pierSide: 'unknown',
        tracking: false,
      })
    })

    it('still reports an offset the driver does set', async () => {
      am5({ rightAscensionRateSecondsPerSiderealSecond: { status: 'fresh', value: 0.5, observedAt: Date.now() } })
      await vi.advanceTimersByTimeAsync(1000)

      expect(await equipment.framing.telescopeStatus('mount', undefined, { includeAlignmentObservations: true })).toMatchObject({
        rightAscensionRateSecondsPerSiderealSecond: 0.5,
        declinationRateArcsecondsPerSecond: 0,
      })
    })

    it.each([
      ['stale', { status: 'stale', value: 0, observedAt: 1 } as const],
      ['unreadable', { status: 'unavailable', reason: 'failed' } as const],
      ['not yet read', { status: 'unavailable', reason: 'not-read' } as const],
    ])('refuses a %s offset', async (_name, reading) => {
      am5({ declinationRateArcsecondsPerSecond: reading })
      await vi.advanceTimersByTimeAsync(1000)

      await expect(equipment.framing.telescopeStatus('mount', undefined, { includeAlignmentObservations: true })).rejects.toMatchObject({ reason: 'transport' })
    })

    it('refuses an unsupported offset when the tracking rate is not sidereal', async () => {
      am5({ trackingRate: { status: 'fresh', value: 'lunar', observedAt: Date.now() } })
      await vi.advanceTimersByTimeAsync(1000)

      await expect(equipment.framing.telescopeStatus('mount', undefined, { includeAlignmentObservations: true })).rejects.toMatchObject({ reason: 'transport' })
    })

    it('does not read the offsets for an ordinary status', async () => {
      am5()
      await vi.advanceTimersByTimeAsync(1000)

      expect(await equipment.framing.telescopeStatus('mount')).not.toHaveProperty('rightAscensionRateSecondsPerSiderealSecond')
    })
  })

  it('uses Cria availability for commands and keeps valid readings visible', async () => {
    cria.commandsEnabled = false
    await vi.advanceTimersByTimeAsync(1000)
    const devices = await equipment.provider.inspectDevices()

    expect(devices[0]).toMatchObject({
      connection: 'connected',
      observation: { state: 'current', commandReady: false, message: 'Commands are disabled' },
      telemetry: { values: { sensorTemperatureC: -10 } },
    })
    expect(await equipment.mountControl.observe('mount')).toBeUndefined()
    expect(cria.received.filter(request => request.route === 'submit')).toHaveLength(0)
  })

  it('retains the last measurement during stream loss and reconnects without a command', async () => {
    const before = await equipment.provider.inspectDevices()
    cria.reachable = false
    await vi.advanceTimersByTimeAsync(3100)
    expect((await equipment.provider.inspectDevices())[0]).toMatchObject({
      telemetry: before[0]?.telemetry,
      observation: { state: 'interrupted', commandReady: false, observedAt: before[0]?.observation?.observedAt },
    })
    cria.reachable = true
    await vi.advanceTimersByTimeAsync(2000)
    expect((await equipment.provider.inspectDevices())[0]?.observation?.state).toBe('current')
    expect(cria.received.filter(request => request.route === 'submit')).toHaveLength(0)
  })

  it('propagates interrupted required readings and accepts them again without a freshness derivation', async () => {
    let stale = true
    cria.deviceView = device => device.kind === 'camera' && stale
      ? { ...device, readings: { ...device.readings, pixelWidthMicrons: { status: 'stale', value: 3.76, observedAt: Date.now() } } }
      : device
    await vi.advanceTimersByTimeAsync(1000)
    await expect(equipment.framing.cameraGeometry({ cameraId: 'camera' })).rejects.toMatchObject({ reason: 'transport' })
    stale = false
    await vi.advanceTimersByTimeAsync(1000)
    expect(await equipment.framing.cameraGeometry({ cameraId: 'camera' })).toMatchObject({ width: 4, height: 3, pixelWidthMicrons: 3.76 })
  })

  it('waits for Cria to refresh readings after a settled write', async () => {
    let refreshing = true
    cria.deviceView = device => device.kind === 'mount' && refreshing
      ? { ...device, availability: { ready: false, reason: 'refreshing', message: 'Waiting for fresh readings' } }
      : device
    await vi.advanceTimersByTimeAsync(1000)
    let answered = false

    const reading = equipment.framing.telescopeStatus('mount').then(value => {
      answered = true

      return value
    })

    await vi.advanceTimersByTimeAsync(100)
    expect(answered).toBe(false)
    refreshing = false
    await vi.advanceTimersByTimeAsync(1000)
    expect(await reading).toMatchObject({ tracking: true, parked: false, coordinateSystem: 'topocentric' })
  })

  it('shows the acknowledged cooling target when setpoint readback is unsupported', async () => {
    cria.deviceView = device => device.kind === 'camera'
      ? { ...device, lastCommandedSetpointC: { value: -15, commandedAt: Date.now() } }
      : device
    await vi.advanceTimersByTimeAsync(1000)
    expect(await equipment.cooling.observe('camera')).toMatchObject({ state: 'on', sensorTemperatureC: -10, setpointC: -15 })
    const changing = equipment.cooling.setCooling({ cameraId: 'camera', setpointC: -20 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(await changing).toMatchObject({ outcome: 'confirmed', observation: { state: 'on', setpointC: -20 } })
    expect(cria.received.filter(request => request.route === 'submit')).toHaveLength(1)
  })

  it('does not dispatch an unsupported coordinate frame', async () => {
    await expect(equipment.framing.slew({ telescopeId: 'mount', coordinateSystem: 'b1950', rightAscensionDegrees: 10, declinationDegrees: 20 })).rejects.toThrow('known mount coordinate frame')
    expect(cria.received.filter(request => request.route === 'submit')).toHaveLength(0)
  })

  it('stops on an exhausted image transfer after one exposure instead of allowing a replacement', async () => {
    await connection.close()
    let downloads = 0

    connection = createCriaConnection({
      origin: cria.origin,
      fetch: async (input, init) => {
        if (new Request(input, init).url.includes('/v2/images/')) {
          downloads++
          throw new TypeError('Image transfer unavailable')
        }

        return cria.fetch(input, init)
      },
    })
    equipment = createCriaEquipment(connection, [
      { providerDeviceId: 'camera', id: 'camera', kind: 'camera', expectedName: 'Fake CCD' },
    ])
    connection.start()
    await vi.advanceTimersByTimeAsync(10)

    const captured = equipment.acquisition.capture({ cameraId: 'camera', exposureSeconds: 1 }).then(
      () => undefined,
      error => error,
    )

    await vi.advanceTimersByTimeAsync(3_000)
    expect(await captured).toBeInstanceOf(EquipmentError)
    expect(downloads).toBe(3)
    expect(cria.received.filter(request => request.route === 'submit')).toHaveLength(1)
  })

  it('reports the request, operation and image IDs of an exposure as it learns them', async () => {
    const seen: CaptureProvenance[] = []
    const captured = equipment.acquisition.capture({ cameraId: 'camera', exposureSeconds: 1, onProvenance: provenance => seen.push(provenance) })

    await vi.advanceTimersByTimeAsync(2_000)
    await captured

    const submitted = JSON.parse(cria.received.find(request => request.route === 'submit')!.body!)
    const settled = (await (await cria.fetch(`${cria.origin}/v2/state`)).json()).operations[0]

    expect(seen).toEqual([
      { requestId: submitted.requestId, operationId: null, imageId: null },
      { requestId: submitted.requestId, operationId: settled.id, imageId: null },
      { requestId: submitted.requestId, operationId: settled.id, imageId: settled.outcome.value.image.id },
    ])
  })

  it('throws an uncertain error, with the IDs it had, when Cria restarts under an exposure', async () => {
    const seen: CaptureProvenance[] = []

    const captured = equipment.acquisition.capture({ cameraId: 'camera', exposureSeconds: 10, onProvenance: provenance => seen.push(provenance) }).then(
      () => undefined,
      error => error,
    )

    await vi.advanceTimersByTimeAsync(1_000)
    cria.restart()
    await vi.advanceTimersByTimeAsync(2_000)

    expect(await captured).toBeInstanceOf(CaptureUncertainError)
    expect(seen.at(-1)).toEqual({ requestId: expect.any(String), operationId: expect.any(String), imageId: null })
  })

  it('allows a fresh attempt after a preflight refusal that dispatched no exposure', async () => {
    cria.reachable = false
    await vi.advanceTimersByTimeAsync(3_100)
    await expect(equipment.acquisition.capture({ cameraId: 'camera', exposureSeconds: 1 })).rejects.toBeInstanceOf(CaptureRetryableError)
    expect(cria.received.filter(request => request.route === 'submit')).toHaveLength(0)

    cria.reachable = true
    await vi.advanceTimersByTimeAsync(2_000)
    const captured = equipment.acquisition.capture({ cameraId: 'camera', exposureSeconds: 1 })

    await vi.advanceTimersByTimeAsync(2_000)
    expect(await captured).toMatchObject({ width: 4, height: 3, color: { kind: 'mono' } })
    expect(cria.received.filter(request => request.route === 'submit')).toHaveLength(1)
  })

  describe('frame type', () => {
    const submitted = () => cria.received.filter(request => request.route === 'submit').map(request => JSON.parse(request.body!).parameters)

    async function capture(frameType?: CaptureFrameType) {
      const options = { cameraId: 'camera', exposureSeconds: 1 }
      const captured = equipment.acquisition.capture(frameType ? { ...options, frameType } : options).catch((error: EquipmentError) => error)

      await vi.advanceTimersByTimeAsync(2_000)

      return captured
    }

    it.each([
      [undefined, { exposureSeconds: 1, light: true }],
      ['light', { exposureSeconds: 1, light: true }],
      ['dark', { exposureSeconds: 1, light: false }],
      ['dark-flat', { exposureSeconds: 1, light: false }],
      ['flat', { exposureSeconds: 1, light: true, frameType: 'flat' }],
      ['bias', { exposureSeconds: 1, light: false, frameType: 'bias' }],
    ] as const)('sends %s to Cria as %o', async (frameType, parameters) => {
      await capture(frameType)

      expect(submitted()).toEqual([parameters])
    })

    describe('the exposure a bias frame gets', () => {
      type Minimum = { status: 'fresh'; value: number; observedAt: number } | { status: 'unavailable'; reason: 'unsupported' }

      const camera = (exposureMinimum: Minimum) => {
        cria.deviceView = device => device.kind === 'camera'
          ? { ...device, readings: { ...device.readings, exposureMinimum } }
          : device
      }

      it('is the camera minimum Cria publishes now, not a value read earlier', async () => {
        expect(await equipment.acquisition.biasExposureSeconds!('camera')).toBe(0.000032)

        camera({ status: 'fresh', value: 0.0001, observedAt: Date.now() })
        await vi.advanceTimersByTimeAsync(1000)

        expect(await equipment.acquisition.biasExposureSeconds!('camera')).toBe(0.0001)
      })

      it('is refused, not guessed, when Cria has no fresh minimum', async () => {
        camera({ status: 'unavailable', reason: 'unsupported' })
        await vi.advanceTimersByTimeAsync(1000)

        await expect(equipment.acquisition.biasExposureSeconds!('camera')).rejects.toMatchObject({ reason: 'transport' })
      })
    })

    describe('against a Cria from before the frame type', () => {
      beforeEach(() => {
        cria.acceptsFrameType = false
      })

      it.each([undefined, 'light', 'dark', 'dark-flat'] as const)('still takes %s', async frameType => {
        expect(await capture(frameType)).toMatchObject({ width: 4, height: 3 })
      })

      it.each(['flat', 'bias'] as const)('refuses %s with Cria\'s answer and exposes nothing', async frameType => {
        const refused = await capture(frameType)

        expect(refused).toBeInstanceOf(EquipmentError)
        expect(refused).not.toBeInstanceOf(CaptureUncertainError)
        expect(refused).toMatchObject({ message: 'Not an operation request' })
        expect(cria.received.filter(request => request.route === 'submit')).toHaveLength(1)
        expect((await (await cria.fetch(`${cria.origin}/v2/state`)).json()).operations).toEqual([])
      })
    })
  })

  it('keeps a pre-aborted focuser move stopped without sending it', async () => {
    const signal = AbortSignal.abort()
    await expect(equipment.focuser.move({ focuserId: 'focuser', position: 20100, window: { minPosition: 15500, maxPosition: 38000 }, signal })).rejects.toBeInstanceOf(FocuserStoppedError)
    expect(cria.received.filter(request => request.route === 'submit')).toHaveLength(0)
  })

  it('does not fabricate a focuser position from an empty confirmed result', async () => {
    cria.durationMs['focuser-move'] = 10000
    const moving = equipment.focuser.move({ focuserId: 'focuser', position: 20100, window: { minPosition: 15500, maxPosition: 38000 } })
    const rejected = expect(moving).rejects.toBeInstanceOf(EquipmentError)
    await vi.advanceTimersByTimeAsync(10)
    const operation = JSON.parse(cria.received.find(request => request.route === 'submit')?.body ?? '{}')
    const state = await (await cria.fetch(`${cria.origin}/v2/state`)).json()
    expect(operation.kind).toBe('focuser-move')
    cria.settle(state.operations[0].id, { kind: 'confirmed', value: { values: {}, image: null } })
    await vi.advanceTimersByTimeAsync(1000)
    await rejected
  })
})
