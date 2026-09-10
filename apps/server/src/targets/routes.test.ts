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

function setup(settings: { record?: RigCatalogRecord, solver?: boolean, offsetDegrees?: number } = {}) {
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
    home: vi.fn(),
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
    status: 'solved', raDegrees: start.raDegrees - (settings.offsetDegrees ?? 0), decDegrees: start.decDegrees, capturedAt: frame.capturedAt,
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

    for (const body of [{}, { checkId: '' }, { checkId: 1 }, { checkId: 'check', extra: true }]) {
      expect((await command(subject.app, body, 'center')).statusCode).toBe(400)
    }

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

  it.each([false, true])('reports a completed operation consistently when a pending readiness read fails: %s', async fails => {
    const subject = setup({ offsetDegrees: 0.1 })
    expect((await command(subject.app)).statusCode).toBe(200)
    await vi.waitFor(() => expect(subject.hardware.capture).toHaveBeenCalledTimes(1))
    const geometry = await subject.adapter.cameraGeometry({ cameraId: 'camera', expectedCameraName: 'Imaging camera' })
    let entered!: () => void
    let release!: () => void
    const inspecting = new Promise<void>(resolve => { entered = resolve })
    const held = new Promise<void>(resolve => { release = resolve })
    vi.mocked(subject.adapter.cameraGeometry).mockImplementationOnce(async () => {
      entered()
      await held

      if (fails) throw new Error('Camera inspection interrupted')

      return geometry
    })
    const response = subject.app.inject('/api/web/rigs/rig/framing').then(result => result.json())
    await inspecting
    subject.complete()
    await vi.waitFor(() => expect(subject.operations.owner('rig')).toBeUndefined())
    release()
    expect(await response).toMatchObject({
      active: false, phase: 'checked', targetId: start.targetId,
      actual: { checkId: expect.any(String), capturedAt: stamp },
      checkCurrent: !fails, canCenter: !fails,
      unavailableReason: fails ? 'Camera inspection interrupted' : null,
    })
  })

  it.each(['same target', 'different target'])('rejects an older browser check after another check of the %s', async target => {
    const subject = setup({ offsetDegrees: 0.1 })

    async function check(body: typeof start, count: number) {
      expect((await command(subject.app, body)).statusCode).toBe(200)
      await vi.waitFor(() => expect(subject.hardware.capture).toHaveBeenCalledTimes(count))
      subject.complete()
      await vi.waitFor(() => expect(subject.operations.owner('rig')).toBeUndefined())

      return (await subject.app.inject('/api/web/rigs/rig/framing')).json()
    }

    const older = await check(start, 1)
    const latest = await check(target === 'same target' ? start : { ...start, targetId: 'ngc2024', raDegrees: start.raDegrees + 0.1 }, 2)
    expect(older.actual.checkId).toEqual(expect.any(String))
    expect(latest.actual.checkId).not.toBe(older.actual.checkId)
    // Captures may share a timestamp; their identities must still be distinct.
    expect(latest.actual.capturedAt).toBe(older.actual.capturedAt)
    expect(latest.canCenter).toBe(true)
    const rejected = await command(subject.app, { checkId: older.actual.checkId }, 'center')
    expect(rejected.statusCode, rejected.body).toBe(409)
    expect(rejected.json().error).toContain('check has changed')
    expect(subject.hardware.slew).toHaveBeenCalledTimes(2)
    expect(subject.hardware.capture).toHaveBeenCalledTimes(2)
    expect(subject.operations.owner('rig')).toBeUndefined()
    expect((await subject.app.inject('/api/web/rigs/rig/framing')).json().actual.checkId).toBe(latest.actual.checkId)

    const accepted = await command(subject.app, { checkId: latest.actual.checkId }, 'center')
    expect(accepted.statusCode, accepted.body).toBe(200)
    await vi.waitFor(() => expect(subject.hardware.capture).toHaveBeenCalledTimes(3))
    expect(subject.hardware.slew).toHaveBeenCalledTimes(3)
    subject.complete()
    await vi.waitFor(() => expect(subject.operations.owner('rig')).toBeUndefined())
    expect((await subject.app.inject('/api/web/rigs/rig/framing')).json().actual.checkId).not.toBe(latest.actual.checkId)
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

describe('frozen target discovery HTTP boundary', () => {
  it('keeps site, ranking and calculation time across pages and filters without inspecting hardware again', async () => {
    const subject = setup()
    const firstResponse = await subject.app.inject('/api/web/rigs/rig/target-discovery')
    expect(firstResponse.statusCode).toBe(200)
    const first = firstResponse.json()
    expect(first.total).toBeGreaterThan(first.pageSize)
    expect(first.targets).toHaveLength(first.pageSize)
    expect(first.targets.every((target: { opportunity: unknown }) => target.opportunity)).toBe(true)
    expect(first.calculatedAt).toBe(stamp)
    subject.mount.latitudeDegrees = -40
    const next = (await subject.app.inject(`/api/web/rigs/rig/target-discovery?snapshot=${first.snapshotId}&offset=${first.pageSize}`)).json()
    expect(next.snapshotId).toBe(first.snapshotId)
    expect(next.site).toEqual(first.site)
    expect(next.targets.every((target: { id: string }) => !first.targets.some((previous: { id: string }) => previous.id === target.id))).toBe(true)
    const galaxies = (await subject.app.inject(`/api/web/rigs/rig/target-discovery?snapshot=${first.snapshotId}&category=galaxy&filter=broadband`)).json()
    expect(galaxies.targets.length).toBeGreaterThan(0)
    expect(galaxies.targets.every((target: { category: string, filterChoice: string }) => target.category === 'galaxy' && target.filterChoice === 'broadband')).toBe(true)
    expect(subject.adapter.telescopeStatus).toHaveBeenCalledTimes(1)
    const refreshed = (await subject.app.inject('/api/web/rigs/rig/target-discovery')).json()
    expect(refreshed.snapshotId).not.toBe(first.snapshotId)
    expect(refreshed.site.latitudeDegrees).toBe(-40)
    expect(subject.hardware.slew).not.toHaveBeenCalled()
    expect(subject.hardware.capture).not.toHaveBeenCalled()
  })

  it('retains catalog search without a usable site and never silently replaces a missing snapshot', async () => {
    const subject = setup()
    delete subject.mount.latitudeDegrees
    const view = (await subject.app.inject('/api/web/rigs/rig/target-discovery?q=M31')).json()
    expect(view.status).toBe('site-unavailable')
    expect(view.site).toBeNull()
    expect(view.targets.some((target: { name: string }) => target.name === 'Andromeda Galaxy')).toBe(true)
    expect(view.targets.every((target: { opportunity: unknown }) => target.opportunity === null)).toBe(true)
    const calls = vi.mocked(subject.adapter.telescopeStatus).mock.calls.length
    expect((await subject.app.inject('/api/web/rigs/rig/target-discovery?snapshot=00000000-0000-0000-0000-000000000000')).statusCode).toBe(410)
    expect(subject.adapter.telescopeStatus).toHaveBeenCalledTimes(calls)

    for (const query of ['category=potato', 'filter=red', 'offset=-1', 'offset=0.1', 'q=a&q=b', 'snapshot=no']) {
      expect((await subject.app.inject(`/api/web/rigs/rig/target-discovery?${query}`)).statusCode).toBe(400)
    }
  })
})
