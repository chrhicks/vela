import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CaptureStoppedError,
  type Acquisition,
  type CameraCooling,
  type EquipmentInspection,
  type EquipmentProvider,
  type Focuser,
  type Frame,
  type Framing,
} from '@vela/equipment'
import { buildApp } from '../app.js'
import { createMemoryRigCatalog } from '../rig/catalog.js'
import type { RigCatalogRecord, RigEquipmentSource } from '../rig/contracts.js'
import { createRigDeviceInventory } from '../device/inventory.js'
import { createEquipmentComposition, type EquipmentComposition } from './composition.js'

const rig: RigCatalogRecord = {
  id: 'cria-rig',
  name: 'Cria fixture',
  source: { kind: 'cria', configurationId: 'cria-rig' },
  endpoint: { host: 'must-not-contact-alpaca.invalid', port: 11111 },
  imagingCamera: { uniqueId: 'cria:camera', name: 'Camera' },
  focalLengthMm: 400,
  addedAt: '2026-10-06T12:00:00.000Z',
  lastObservedInventory: {
    observedAt: '2026-10-06T12:00:00.000Z',
    devices: [
      { uniqueId: 'cria:camera', kind: 'camera', name: 'Camera' },
      { uniqueId: 'cria:mount', kind: 'telescope', name: 'Mount' },
      { uniqueId: 'cria:focus', kind: 'focuser', name: 'Focuser' },
    ],
  },
}

const apps: Array<ReturnType<typeof buildApp>> = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()))
  vi.restoreAllMocks()
})

function setup({ savedCameraName = 'Camera' }: { savedCameraName?: string } = {}) {
  const unexpectedFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected device transport'))
  let connected = true
  let ready = true
  let holds: Array<{ deviceId: string; reason: string }> = []
  const selected: Array<{ capability: string; rig: RigEquipmentSource }> = []

  function select(capability: string, source: RigEquipmentSource) {
    selected.push({ capability, rig: source })
    expect(source.source).toEqual(rig.source)
  }

  const provider: EquipmentProvider = {
    async listDevices() {
      return rig.lastObservedInventory.devices.map(device => ({
        providerDeviceId: device.uniqueId,
        kind: device.kind,
        name: device.name,
        connection: connected ? 'connected' : 'disconnected',
        driver: {},
      }))
    },
    async inspectDevices() {
      const camera: EquipmentInspection = {
        providerDeviceId: 'cria:camera',
        kind: 'camera',
        configuredName: 'Camera',
        name: 'Camera',
        connection: connected ? 'connected' : 'disconnected',
        observation: {
          state: ready ? 'current' : 'interrupted',
          commandReady: ready,
          message: 'Readings interrupted',
        },
        telemetry: {
          availability: 'complete',
          values: { kind: 'camera', activity: 'idle', cooling: { state: 'off', setpointControl: true } },
        },
      }

      return [
        camera,
        {
          providerDeviceId: 'cria:mount',
          kind: 'telescope',
          configuredName: 'Mount',
          name: 'Mount',
          connection: 'connected',
          telemetry: {
            availability: 'complete',
            values: { kind: 'telescope', tracking: true, slewing: false, parked: false },
          },
        },
        {
          providerDeviceId: 'cria:focus',
          kind: 'focuser',
          configuredName: 'Focuser',
          name: 'Focuser',
          connection: 'connected',
          telemetry: {
            availability: 'complete',
            values: { kind: 'focuser', position: 1000, maxStep: 100000, moving: false },
          },
        },
      ]
    },
    async connectDevice() {
      connected = true

      return { outcome: 'connected', command: 'requested' }
    },
  }

  const capture = vi.fn<Acquisition['capture']>(async ({ signal }) => {
    signal?.throwIfAborted()

    return new Promise<Frame>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new CaptureStoppedError()), { once: true })
    })
  })

  const acquisition: Acquisition = {
    capture,
    pointing: async () => ({
      rightAscensionDegrees: 12,
      declinationDegrees: 60,
      siderealTimeDegrees: 60,
      latitudeDegrees: 37,
      tracking: true,
      coordinateSystem: 'j2000',
    }),
    move: async () => {},
    rotateRightAscension: async () => {},
    abort: async () => {},
  }

  const framing: Framing = {
    cameraGeometry: async () => ({
      cameraName: 'Camera',
      sensorWidthPixels: 64,
      sensorHeightPixels: 48,
      width: 64,
      height: 48,
      pixelWidthMicrons: 3.76,
      pixelHeightMicrons: 3.76,
      binX: 1,
      binY: 1,
      startX: 0,
      startY: 0,
    }),
    telescopeStatus: async () => ({
      rightAscensionDegrees: 250,
      declinationDegrees: 36,
      coordinateSystem: 'j2000',
      latitudeDegrees: 37,
      longitudeDegrees: -76,
      tracking: true,
      slewing: false,
      parked: false,
      observedAt: new Date().toISOString(),
    }),
    setTracking: async () => {},
    slew: async () => {},
    home: async () => {},
    abortTelescope: async () => {},
  }

  const focuser = {
    status: async () => ({ absolute: true, position: 1000, maxStep: 100000, moving: false }),
    move: vi.fn<Focuser['move']>(async command => ({ position: command.position })),
    halt: async () => {},
  }

  const setCooling = vi.fn<CameraCooling['setCooling']>(async () => ({
    outcome: 'confirmed',
    observation: { state: 'on', canSetTemperature: true, canGetPower: false },
  }))

  const recover = vi.fn<EquipmentComposition['recover']>(async (_rig, deviceId) => {
    if (!holds.some(hold => hold.deviceId === deviceId))
      return { outcome: 'failed', busy: false, message: 'That device is not held.' }
    holds = holds.filter(hold => hold.deviceId !== deviceId)

    return { outcome: 'confirmed', found: 'The mount is stationary.' }
  })

  const equipment: EquipmentComposition = {
    start() {},
    async close() {},
    alpacaDiscovery: {
      scan: async () => [],
      inspect: async () => { throw new Error('Cria rigs are never inspected through Alpaca') },
    },
    createInventory(source) {
      select('inventory', source)

      return createRigDeviceInventory(source, { provider })
    },
    createInspector(source) {
      select('inspection', source)

      return provider
    },
    createConnector(source) {
      select('connection', source)

      return provider
    },
    createAcquisition(source) {
      select('acquisition', source)

      return acquisition
    },
    createAlignmentEndpointAcquisition: () => acquisition,
    createFraming(source) {
      select('framing', source)

      return framing
    },
    createFocuser(source) {
      select('focuser', source)

      return focuser
    },
    createMountControl() {
      return {
        observe: async () => undefined,
        execute: async () => ({ outcome: 'failed', reason: 'unsupported' }),
      }
    },
    createCooling(source) {
      select('cooling', source)

      return { observe: async () => undefined, setCooling }
    },
    alignmentSettings: () => ({
      rigId: rig.id,
      endpoint: 'http://cria.local:4319',
      mode: 'offline',
      cameraId: 'cria:camera',
      telescopeId: 'cria:mount',
      executable: '/not-executed',
      catalogPath: '/not-executed',
      exposureSeconds: 1,
      fieldHeightDegrees: 3,
    }),
    holdsOf: rigId => (rigId === rig.id ? holds : []),
    recover,
  }

  const app = buildApp({
    rigCatalog: createMemoryRigCatalog([
      { ...rig, imagingCamera: { uniqueId: 'cria:camera', name: savedCameraName } },
    ]),
    equipment,
    targets: {
      createSolver: () => ({ solve: async () => ({ status: 'no-solution' }) }),
      waitForMountObservation: async () => {},
    },
  })

  apps.push(app)

  return {
    app, capture, selected, unexpectedFetch, focuser, setCooling, recover,
    hold(reason: string) { holds = [{ deviceId: 'cria:mount', reason }] },
    disconnected() { connected = false },
    interrupted() { ready = false },
  }
}

describe('equipment selection at server composition', () => {
  it('checks fresh Cria observations before enabling alignment or starting its equipment work', async () => {
    const subject = setup()
    subject.interrupted()
    const view = (await subject.app.inject('/api/web/rigs/cria-rig/alignment')).json()

    expect(view).toMatchObject({ enabled: false, unavailableReason: 'Readings interrupted' })

    const response = await subject.app.inject({
      method: 'POST', url: '/api/rigs/cria-rig/alignment/start', payload: {},
    })

    expect(response.statusCode).toBe(409)
    expect(subject.capture).not.toHaveBeenCalled()
    expect(subject.unexpectedFetch).not.toHaveBeenCalled()
  })

  it.each([
    { workflow: 'capture', payload: { exposureSeconds: 1 }, capabilities: ['acquisition'] },
    { workflow: 'autofocus', payload: { stepSize: 10 }, capabilities: ['acquisition', 'focuser'] },
    { workflow: 'framing', payload: { targetId: 'ngc6205', raDegrees: 250, decDegrees: 36, exposureSeconds: 1 }, capabilities: ['framing', 'acquisition'] },
    { workflow: 'alignment', payload: {}, capabilities: ['acquisition'] },
  ])('routes $workflow through the configured rig capabilities', async ({ workflow, payload, capabilities }) => {
    const subject = setup()
    const start = await subject.app.inject({ method: 'POST', url: `/api/rigs/${rig.id}/${workflow}/start`, payload })
    expect(start.statusCode).toBe(200)
    await vi.waitFor(() => expect(subject.capture).toHaveBeenCalledOnce())

    for (const capability of capabilities)
      expect(subject.selected.some(call => call.capability === capability)).toBe(true)
    expect(subject.capture.mock.calls[0]![0].cameraId).toBe('cria:camera')
    expect((await subject.app.inject({ method: 'POST', url: `/api/rigs/${rig.id}/${workflow}/stop` })).statusCode).toBe(200)
    expect(subject.unexpectedFetch).not.toHaveBeenCalled()
  })

  it('preserves the source for inventory, inspection, connection and cooling', async () => {
    const subject = setup()
    subject.disconnected()
    expect((await subject.app.inject('/api/web/home')).statusCode).toBe(200)
    expect((await subject.app.inject({ method: 'POST', url: `/api/rigs/${rig.id}/connections`, payload: {} })).statusCode).toBe(200)
    expect((await subject.app.inject({ method: 'POST', url: `/api/rigs/${rig.id}/capture/cooling`, payload: { coolerOn: true } })).statusCode).toBe(200)
    expect(subject.selected.map(call => call.capability)).toEqual(expect.arrayContaining(['inventory', 'inspection', 'connection', 'cooling']))
    expect(subject.unexpectedFetch).not.toHaveBeenCalled()
  })

  it('does not enable capture or show retained cooling as current after Cria readings are interrupted', async () => {
    const subject = setup()
    subject.interrupted()
    const view = (await subject.app.inject(`/api/web/rigs/${rig.id}/capture`)).json()
    expect(view).toMatchObject({ enabled: false, cooling: null, unavailableReason: 'Readings interrupted' })
    expect((await subject.app.inject({ method: 'POST', url: `/api/rigs/${rig.id}/capture/start`, payload: { exposureSeconds: 1 } })).statusCode).toBe(409)
    expect(subject.capture).not.toHaveBeenCalled()
  })

  it('never falls back to Alpaca when a persisted Cria source has no server configuration', () => {
    const equipment = createEquipmentComposition()

    for (const create of [equipment.createInventory, equipment.createInspector, equipment.createConnector, equipment.createAcquisition, equipment.createFraming, equipment.createFocuser, equipment.createCooling])
      expect(() => create(rig)).toThrow('Cria equipment connection is unavailable')
  })
})

describe('device holds through the lease routes', () => {
  const reason = 'The mount did not confirm it stopped after a slew. Check it before recovering.'
  const recoverUrl = `/api/rigs/${rig.id}/devices/cria:mount/recover`

  it('refuses work while the mount is held and starts autofocus after recover', async () => {
    const subject = setup()
    subject.hold(reason)

    expect((await subject.app.inject(`/api/web/rigs/${rig.id}/autofocus`)).json())
      .toMatchObject({ enabled: false, unavailableReason: reason })
    const autofocus = await subject.app.inject({ method: 'POST', url: `/api/rigs/${rig.id}/autofocus/start`, payload: { stepSize: 10 } })
    expect(autofocus.statusCode).toBe(409)
    expect(autofocus.json()).toEqual({ error: reason })

    expect((await subject.app.inject(`/api/web/rigs/${rig.id}/capture`)).json()).toMatchObject({
      enabled: false,
      unavailableReason: reason,
      cooling: { state: 'off', canSetTemperature: true, blockedBy: { kind: 'hold', reason } },
    })
    const cooling = await subject.app.inject({ method: 'POST', url: `/api/rigs/${rig.id}/capture/cooling`, payload: { coolerOn: true } })
    expect(cooling.statusCode).toBe(409)
    expect(cooling.json()).toEqual({ error: reason })

    const forget = await subject.app.inject({ method: 'DELETE', url: `/api/rigs/${rig.id}` })
    expect(forget.statusCode).toBe(409)
    expect(forget.json()).toEqual({ error: 'rig-operation-in-progress', message: reason })
    const connection = await subject.app.inject({ method: 'POST', url: `/api/rigs/${rig.id}/connections`, payload: {} })
    expect(connection.statusCode).toBe(409)
    expect(connection.json()).toEqual({ error: 'rig-operation-in-progress', message: reason })

    expect(subject.capture).not.toHaveBeenCalled()
    expect(subject.focuser.move).not.toHaveBeenCalled()
    expect(subject.setCooling).not.toHaveBeenCalled()

    const recovered = await subject.app.inject({
      method: 'POST',
      url: recoverUrl,
      payload: { externalRecoveryConfirmed: true, note: '  Checked the mount at the pier.  ' },
    })

    expect(recovered.statusCode).toBe(200)
    expect(recovered.json()).toEqual({ outcome: 'confirmed', found: 'The mount is stationary.' })
    expect(subject.recover.mock.calls.map(([held, deviceId, note]) => [held.id, deviceId, note]))
      .toEqual([[rig.id, 'cria:mount', 'Checked the mount at the pier.']])

    const started = await subject.app.inject({ method: 'POST', url: `/api/rigs/${rig.id}/autofocus/start`, payload: { stepSize: 10 } })
    expect(started.statusCode).toBe(200)
    await vi.waitFor(() => expect(subject.capture).toHaveBeenCalledOnce())
    expect(subject.focuser.move.mock.calls[0]![0].position).toBe(1040)
    expect((await subject.app.inject({ method: 'POST', url: `/api/rigs/${rig.id}/autofocus/stop` })).statusCode).toBe(200)
  })

  it('validates the temporary recover request and reports a recovery that did not confirm', async () => {
    const subject = setup()

    for (const payload of [
      {},
      { externalRecoveryConfirmed: false, note: 'Checked the mount.' },
      { externalRecoveryConfirmed: true, note: '   ' },
      { externalRecoveryConfirmed: true, note: 'x'.repeat(1001) },
      { externalRecoveryConfirmed: true, note: 'Checked the mount.', deviceId: 'cria:camera' },
    ]) {
      expect((await subject.app.inject({ method: 'POST', url: recoverUrl, payload })).statusCode).toBe(400)
    }

    const missing = await subject.app.inject({
      method: 'POST',
      url: '/api/rigs/unknown/devices/cria:mount/recover',
      payload: { externalRecoveryConfirmed: true, note: 'Checked the mount.' },
    })

    expect(missing.statusCode).toBe(404)
    expect(subject.recover).not.toHaveBeenCalled()

    const failed = await subject.app.inject({
      method: 'POST',
      url: recoverUrl,
      payload: { externalRecoveryConfirmed: true, note: 'Checked the mount.' },
    })

    expect(failed.statusCode).toBe(409)
    expect(failed.json()).toEqual({ error: 'recovery-failed', reason: 'That device is not held.' })

    subject.recover.mockResolvedValueOnce({ outcome: 'failed', busy: true, message: 'Another operation is open.' })

    const busy = await subject.app.inject({
      method: 'POST',
      url: recoverUrl,
      payload: { externalRecoveryConfirmed: true, note: 'Checked the mount.' },
    })

    expect(busy.statusCode).toBe(409)
    expect(busy.json()).toEqual({ error: 'device-busy', reason: 'Another operation is open.' })
  })
})

describe('a Cria rig whose saved camera name predates protocol 5', () => {
  it('shows the selected camera as ready under the name Cria reports', async () => {
    const subject = setup({ savedCameraName: 'ZWO ASI2600MC Pro' })

    expect((await subject.app.inject(`/api/web/rigs/${rig.id}/imaging-camera`)).json())
      .toMatchObject({ state: 'ready', selected: { id: 'cria:camera', name: 'Camera' } })
    expect((await subject.app.inject(`/api/web/rigs/${rig.id}/capture`)).json())
      .toMatchObject({ enabled: true, camera: { name: 'Camera' } })
    expect((await subject.app.inject(`/api/web/rigs/${rig.id}/autofocus`)).json())
      .toMatchObject({ enabled: true, cameraName: 'Camera' })
  })

  it.each([
    { workflow: 'capture', payload: { exposureSeconds: 1 } },
    { workflow: 'autofocus', payload: { stepSize: 10 } },
    { workflow: 'framing', payload: { targetId: 'ngc6205', raDegrees: 250, decDegrees: 36, exposureSeconds: 1 } },
  ])('starts $workflow and expects the camera name Cria reports', async ({ workflow, payload }) => {
    const subject = setup({ savedCameraName: 'ZWO ASI2600MC Pro' })
    const start = await subject.app.inject({ method: 'POST', url: `/api/rigs/${rig.id}/${workflow}/start`, payload })

    expect(start.statusCode).toBe(200)
    await vi.waitFor(() => expect(subject.capture).toHaveBeenCalledOnce())
    expect(subject.capture.mock.calls[0]![0].expectedCameraName).toBe('Camera')
    expect((await subject.app.inject({ method: 'POST', url: `/api/rigs/${rig.id}/${workflow}/stop` })).statusCode).toBe(200)
  })
})
