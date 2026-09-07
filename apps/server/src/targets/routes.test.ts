import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AlpacaDeviceInspection, AlpacaFraming, AlpacaTelescopeStatus } from '@vela/alpaca'
import { createMemoryRigCatalog } from '../rig/catalog.js'
import type { RigCatalogRecord } from '../rig/contracts.js'
import { createRigOperations } from '../rig/operations.js'
import type { MonoFrame, PlateSolver } from '../plate-solving/solver.js'
import type { FramingHardware } from './framing.js'
import { registerTargets } from './routes.js'

const stamp = '2026-09-07T22:00:00.000Z'
const record: RigCatalogRecord = {
  id: 'rig', name: 'Test rig', endpoint: { host: 'rig.local', port: 11111 },
  addedAt: stamp, focalLengthMm: 400,
  imagingCamera: { uniqueId: 'camera', name: 'Imaging camera' },
  lastObservedInventory: { observedAt: stamp, devices: [
    { uniqueId: 'camera', kind: 'camera', name: 'Camera slot' },
    { uniqueId: 'mount', kind: 'telescope', name: 'Mount slot' },
  ] },
}
const start = { targetId: 'ngc6205', raDegrees: 250.42345833, decDegrees: 36.46130556, exposureSeconds: 2 }
const apps: ReturnType<typeof Fastify>[] = []
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())) })

function setup(settings: { record?: RigCatalogRecord, solver?: boolean } = {}) {
  const catalog = createMemoryRigCatalog([settings.record ?? record])
  const operations = createRigOperations()
  const mount: AlpacaTelescopeStatus = {
    rightAscensionDegrees: start.raDegrees, declinationDegrees: start.decDegrees,
    coordinateSystem: 'j2000', latitudeDegrees: 40, longitudeDegrees: -75, elevationMeters: 100,
    tracking: true, slewing: false, parked: false, observedAt: stamp,
  }
  const inspections: AlpacaDeviceInspection[] = [
    { providerDeviceId: 'camera', kind: 'camera', configuredName: 'Camera slot', name: 'Imaging camera',
      connection: 'connected', telemetry: { availability: 'complete', values: { kind: 'camera', activity: 'idle' } } },
    { providerDeviceId: 'mount', kind: 'telescope', configuredName: 'Mount slot', name: 'Mount',
      connection: 'connected', telemetry: { availability: 'unavailable' } },
  ]
  const adapter: AlpacaFraming = {
    cameraGeometry: vi.fn(async () => ({ cameraName: 'Imaging camera', sensorWidthPixels: 1000,
      sensorHeightPixels: 800, pixelWidthMicrons: 3.76, pixelHeightMicrons: 3.76,
      binX: 1, binY: 1, width: 1000, height: 800, startX: 0, startY: 0 })),
    telescopeStatus: vi.fn(async () => ({ ...mount })),
    slew: vi.fn(async () => {}), setTracking: vi.fn(async () => {}), abortTelescope: vi.fn(async () => {}),
  }
  let completeCapture!: (frame: MonoFrame) => void
  const hardware: FramingHardware = {
    status: vi.fn(async () => ({ ...mount })),
    tracking: vi.fn(async () => {}), slew: vi.fn(async () => {}),
    capture: vi.fn<FramingHardware['capture']>((_seconds, signal) => new Promise<MonoFrame>((resolve, reject) => {
      completeCapture = resolve
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })),
  }
  const solver: PlateSolver = { solve: vi.fn<PlateSolver['solve']>(async (frame) => ({
    status: 'solved', raDegrees: start.raDegrees, decDegrees: start.decDegrees, capturedAt: frame.capturedAt,
    wcs: { width: 1000, height: 800, referenceX: 500.5, referenceY: 400.5,
      raDegrees: start.raDegrees, decDegrees: start.decDegrees, cd: [-0.001, 0, 0, 0.001] },
  })) }
  const options = {
    createAdapter: () => adapter, createHardware: () => hardware,
    createInspector: () => ({ inspectDevices: async () => inspections }),
    ...(settings.solver === false ? {} : { createSolver: () => solver }), now: () => new Date(stamp),
  }
  function createApp() {
    const app = Fastify()
    registerTargets(app, catalog, operations, options)
    apps.push(app)
    return app
  }
  return { app: createApp(), createApp, catalog, operations, inspections, adapter, hardware, mount, solver,
    complete: () => completeCapture({ width: 1000, height: 800, pixels: [], capturedAt: stamp }) }
}

function command(app: ReturnType<typeof Fastify>, body: unknown = start, name = 'start') {
  return app.inject({ method: 'POST', url: `/api/rigs/rig/framing/${name}`, payload: JSON.stringify(body),
    headers: { 'content-type': 'application/json' } })
}

describe('target and framing HTTP boundary', () => {
  it('rejects malformed commands and settings without starting hardware work', async () => {
    const subject = setup()
    for (const body of [null, [], {}, { ...start, targetId: 'unknown' }, { ...start, raDegrees: 360 },
      { ...start, decDegrees: -91 }, { ...start, exposureSeconds: '2' }, { ...start, exposureSeconds: 61 },
      { ...start, surprise: true }]) {
      expect((await command(subject.app, body)).statusCode).toBe(400)
    }
    for (const body of [{ focalLengthMm: 0 }, { focalLengthMm: '400' }, { focalLengthMm: 400, extra: true }]) {
      expect((await subject.app.inject({ method: 'PUT', url: '/api/rigs/rig/framing/settings', payload: body })).statusCode).toBe(400)
    }
    expect((await command(subject.app, { extra: true }, 'stop')).statusCode).toBe(400)
    expect(subject.hardware.slew).not.toHaveBeenCalled()
    expect(subject.hardware.capture).not.toHaveBeenCalled()
    expect(subject.operations.owner('rig')).toBeUndefined()
  })

  it('stores focal settings in the catalog and reconstructs the field from saved values', async () => {
    const subject = setup()
    const before = (await subject.app.inject('/api/web/rigs/rig/framing')).json()
    const saved = await subject.app.inject({ method: 'PUT', url: '/api/rigs/rig/framing/settings', payload: { focalLengthMm: 800 } })
    expect(saved.statusCode).toBe(200)
    expect((await subject.catalog.get('rig'))?.focalLengthMm).toBe(800)
    await subject.app.close()
    const reopened = subject.createApp()
    const after = (await reopened.inject('/api/web/rigs/rig/framing')).json()
    expect(after.focalLengthMm).toBe(800)
    expect(after.camera.fieldWidthDegrees).toBeLessThan(before.camera.fieldWidthDegrees)
    expect(subject.hardware.slew).not.toHaveBeenCalled()
  })

  it.each(['unselected', 'renamed', 'disconnected', 'busy', 'site', 'solver'] as const)(
    'rejects commands when readiness is missing: %s', async (failure) => {
      const { imagingCamera: _camera, ...unselected } = record
      const subject = setup({ ...(failure === 'unselected' ? { record: unselected } : {}), solver: failure !== 'solver' })
      if (failure === 'renamed') subject.inspections[0] = { ...subject.inspections[0]!, name: 'Different camera' }
      if (failure === 'disconnected') subject.inspections[0] = { ...subject.inspections[0]!, connection: 'disconnected' }
      if (failure === 'busy') subject.inspections[0] = { ...subject.inspections[0]!,
        telemetry: { availability: 'complete', values: { kind: 'camera', activity: 'exposing' } } }
      if (failure === 'site') delete subject.mount.latitudeDegrees
      const result = await command(subject.app)
      expect(result.statusCode, result.body).toBe(409)
      expect(subject.hardware.slew).not.toHaveBeenCalled()
      expect(subject.hardware.tracking).not.toHaveBeenCalled()
      expect(subject.hardware.capture).not.toHaveBeenCalled()
      expect(subject.solver.solve).not.toHaveBeenCalled()
      expect(subject.operations.owner('rig')).toBeUndefined()
    },
  )

  it('honors another capture owner for start and focal-setting commands', async () => {
    const subject = setup()
    const release = subject.operations.acquire('rig', 'capture')!
    try {
      expect((await command(subject.app)).statusCode).toBe(409)
      expect((await subject.app.inject({ method: 'PUT', url: '/api/rigs/rig/framing/settings', payload: { focalLengthMm: 500 } })).statusCode).toBe(409)
      expect(subject.hardware.slew).not.toHaveBeenCalled()
      expect(subject.operations.owner('rig')).toBe('capture')
      expect((await subject.catalog.get('rig'))?.focalLengthMm).toBe(400)
    } finally { release() }
  })

  it('keeps the active check server-owned across browser reconnects and rejects duplicate starts', async () => {
    const subject = setup()
    const started = await command(subject.app)
    expect(started.statusCode, started.body).toBe(200)
    await vi.waitFor(() => expect(subject.hardware.capture).toHaveBeenCalledTimes(1))
    expect(subject.operations.owner('rig')).toBe('framing')
    const reconnected = await subject.app.inject('/api/web/rigs/rig/framing')
    expect(reconnected.json()).toMatchObject({ active: true, phase: 'exposing', targetId: 'ngc6205' })
    expect((await command(subject.app)).statusCode).toBe(409)
    expect(subject.hardware.slew).toHaveBeenCalledTimes(1)
    subject.complete()
    await vi.waitFor(() => expect(subject.operations.owner('rig')).toBeUndefined())
    const completed = await subject.app.inject('/api/web/rigs/rig/framing')
    expect(completed.json()).toMatchObject({ active: false, phase: 'checked', actual: { capturedAt: stamp } })
    expect(subject.solver.solve).toHaveBeenCalledTimes(1)
  })

  it('serves real catalog identity without inventing a site and rejects malformed searches', async () => {
    const subject = setup()
    delete subject.mount.latitudeDegrees
    const target = await subject.app.inject('/api/web/rigs/rig/targets/ngc6205')
    expect(target.json()).toMatchObject({ id: 'ngc6205', catalog: 'NGC 6205', sky: null, raDegrees: start.raDegrees })
    const search = await subject.app.inject('/api/web/rigs/rig/targets?q=Flame')
    expect(search.json().targets.map((item: { id: string }) => item.id)).toContain('ngc2024')
    expect(search.json().targets.map((item: { id: string }) => item.id)).not.toContain('ic0434')
    for (const suffix of ['offset=-1', 'offset=1.5', `q=${'a'.repeat(101)}`, 'q=M13&q=M31']) {
      const result = await subject.app.inject(`/api/web/rigs/rig/targets?${suffix}`)
      expect(result.statusCode, suffix).toBe(400)
    }
  })
})
