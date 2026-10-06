import Fastify from 'fastify'
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { EquipmentInspection, MountControl, MountControlCommandResult, MountControlObservation } from '@vela/equipment'
import { createMemoryRigCatalog } from './catalog.js'
import { createRigOperations } from './operations.js'
import { registerMountControls } from './mount-control.js'
import { loadRigDetailView } from './detail.js'

function fixture() {
  const rig = {
    id: 'rig',
    name: 'Test rig',
    endpoint: { host: 'mount.test', port: 11111 },
    addedAt: '2026-10-06T00:00:00.000Z',
    lastObservedInventory: {
      observedAt: '2026-10-06T00:00:00.000Z',
      devices: [{ uniqueId: 'mount', kind: 'telescope' as const, name: 'Mount slot' }],
    },
  }

  let observation: MountControlObservation | undefined = {
    parked: false, tracking: false, slewing: false, canSetTracking: true, canUnpark: true,
  }

  let inspection: EquipmentInspection = {
    providerDeviceId: 'mount',
    name: 'Actual mount',
    configuredName: 'Mount slot',
    kind: 'telescope',
    connection: 'connected',
    telemetry: { availability: 'complete', values: { kind: 'telescope', tracking: false, parked: false, slewing: false } },
  }

  const catalog = createMemoryRigCatalog([rig])
  const operations = createRigOperations()
  const inspectDevices = vi.fn(async () => [inspection])
  const createInspector = () => ({ inspectDevices })

  const execute = vi.fn<MountControl['execute']>(async command => {
    observation = command.kind === 'unpark'
      ? { ...observation, parked: false }
      : { ...observation, tracking: command.tracking }

    return { outcome: 'confirmed', observation }
  })

  const app = Fastify()

  const controls = registerMountControls(app, catalog, operations, {
    createInspector,
    createMountControl: () => ({ observe: async () => observation, execute }),
  })

  async function deviceView() {
    const result = await loadRigDetailView(catalog, 'rig', { createInspector })

    if (result.state !== 'found') throw new Error('Missing fixture rig')
    const detail = await controls.decorate(result.view)
    const mount = detail.devices[0]

    if (mount?.kind !== 'telescope') throw new Error('Missing fixture mount')

    return mount
  }

  const post = (action = 'tracking-on', deviceId = 'rig-mount', requestId = randomUUID()) => app.inject({
    method: 'POST', url: '/api/rigs/rig/mount', payload: { action, deviceId, requestId, serverInstanceId: controls.serverInstanceId },
  })

  return {
    app, serverInstanceId: controls.serverInstanceId, inspectDevices, deviceView, view: async () => (await deviceView()).mountControl!, execute, post, operations,
    rename(value: string) { inspection = { ...inspection, name: value } },
    setObservation(value: MountControlObservation | undefined) { observation = value },
    interrupt() { inspection = { ...inspection, observation: { state: 'interrupted', commandReady: false } } },
  }
}

describe('explicit mount controls', () => {
  it('admits only a current supported action on the validated public mount identity', async () => {
    const f = fixture()

    try {
      expect(await f.view()).toMatchObject({ trackingOn: { enabled: true }, trackingOff: { enabled: false }, unpark: { enabled: false } })
      expect((await f.post('tracking-on', 'mount')).statusCode).toBe(404)
      expect((await f.post('park')).statusCode).toBe(400)
      expect((await f.post('unpark')).statusCode).toBe(409)
      expect(f.execute).not.toHaveBeenCalled()
      const requestId = randomUUID()
      expect((await f.post('tracking-on', 'rig-mount', requestId)).json()).toMatchObject({ command: { requestId, action: 'tracking-on', state: 'confirmed' } })
      expect((await f.post('tracking-on', 'rig-mount', requestId)).json()).toEqual({ error: 'mount-command-already-admitted' })
      expect(f.execute).toHaveBeenCalledExactlyOnceWith({ telescopeId: 'mount', expectedTelescopeName: 'Actual mount', kind: 'set-tracking', tracking: true })
    } finally { await f.app.close() }
  })

  it('retires an unseen request before a delayed original can pass admission, without a physical write', async () => {
    const f = fixture()
    const requestId = randomUUID()
    let finishInspection!: () => void
    f.inspectDevices.mockImplementationOnce(() => new Promise(resolve => {
      finishInspection = async () => resolve(await f.inspectDevices())
    }))

    try {
      const original = f.post('tracking-on', 'rig-mount', requestId)
      await vi.waitFor(() => expect(f.inspectDevices).toHaveBeenCalledOnce())

      const check = () => f.app.inject({
        method: 'POST', url: '/api/rigs/rig/mount/check',
        payload: { deviceId: 'rig-mount', action: 'tracking-on', requestId, serverInstanceId: f.serverInstanceId },
      })

      expect((await check()).json()).toMatchObject({ admission: 'not-admitted', control: { command: null } })
      finishInspection()
      expect((await original).json()).toEqual({ error: 'mount-command-retired' })
      expect((await f.post('tracking-on', 'rig-mount', requestId)).json()).toEqual({ error: 'mount-command-retired' })
      expect((await check()).json().admission).toBe('not-admitted')
      expect(f.execute).not.toHaveBeenCalled()
      expect(f.operations.owner('rig')).toBeUndefined()
    } finally { await f.app.close() }
  })

  it('does not claim a previous server instance never admitted a command', async () => {
    const f = fixture()
    const payload = { deviceId: 'rig-mount', action: 'tracking-on', requestId: randomUUID(), serverInstanceId: randomUUID() }

    try {
      expect((await f.app.inject({ method: 'POST', url: '/api/rigs/rig/mount/check', payload })).json()).toMatchObject({
        admission: 'unknown', control: { serverInstanceId: f.serverInstanceId, command: null },
      })
      expect((await f.app.inject({ method: 'POST', url: '/api/rigs/rig/mount', payload })).json().error).toBe('mount-server-restarted')
      expect(f.execute).not.toHaveBeenCalled()
      expect(f.operations.owner('rig')).toBeUndefined()
    } finally { await f.app.close() }
  })

  it('keeps pending command ownership visible to other browsers and prevents competing commands', async () => {
    const f = fixture()
    let finish!: (value: MountControlCommandResult) => void
    f.execute.mockImplementation(() => new Promise(resolve => { finish = resolve }))

    try {
      const requestId = randomUUID()
      const pending = f.post('tracking-on', 'rig-mount', requestId)
      await vi.waitFor(() => expect(f.execute).toHaveBeenCalledOnce())
      expect(await f.view()).toMatchObject({ command: { state: 'pending' }, trackingOn: { enabled: false } })
      expect(f.operations.acquire('rig', 'capture')).toBeUndefined()
      expect((await f.post()).statusCode).toBe(409)
      expect((await f.app.inject({
        method: 'POST', url: '/api/rigs/rig/mount/check',
        payload: { deviceId: 'rig-mount', action: 'tracking-on', requestId, serverInstanceId: f.serverInstanceId },
      })).json()).toMatchObject({ admission: 'known', control: { command: { requestId, state: 'pending' } } })
      expect((await f.app.inject({
        method: 'POST', url: '/api/rigs/rig/mount/check',
        payload: { deviceId: 'rig-mount', action: 'tracking-off', requestId: randomUUID(), serverInstanceId: f.serverInstanceId },
      })).json()).toMatchObject({ admission: 'not-admitted', control: { command: { requestId, state: 'pending' } } })
      expect(f.execute).toHaveBeenCalledOnce()
      expect(f.operations.owner('rig')).toBe('mount-control')
      finish({ outcome: 'confirmed', observation: { tracking: true, slewing: false } })
      expect((await pending).json()).toMatchObject({ command: { state: 'confirmed' } })
      expect(f.operations.owner('rig')).toBeUndefined()
      expect(f.execute).toHaveBeenCalledOnce()
    } finally { await f.app.close() }
  })

  it('retains uncertainty and ownership until a fresh stationary read resolves the outcome without replay', async () => {
    const f = fixture()
    f.execute.mockResolvedValue({ outcome: 'uncertain', reason: 'verification-unavailable' })

    try {
      expect((await f.post()).json()).toMatchObject({ command: { state: 'uncertain' } })
      f.setObservation(undefined)
      expect(await f.view()).toMatchObject({ command: { state: 'uncertain' }, trackingOff: { enabled: false } })
      expect((await f.post()).statusCode).toBe(409)
      expect(f.operations.acquire('rig', 'capture')).toBeUndefined()
      f.setObservation({ tracking: true, parked: false, slewing: false, canSetTracking: true })
      f.rename('Replacement mount')
      expect(await f.view()).toMatchObject({ command: { state: 'uncertain' } })
      expect(f.operations.owner('rig')).toBe('mount-control')
      f.rename('Actual mount')
      expect(await f.view()).toMatchObject({ command: { state: 'confirmed' }, trackingOff: { enabled: true } })
      expect(f.operations.owner('rig')).toBeUndefined()
      expect(f.execute).toHaveBeenCalledOnce()
    } finally { await f.app.close() }
  })

  it('does not infer unparked or tracking off from unknown or interrupted observations', async () => {
    const f = fixture()

    try {
      f.setObservation({ tracking: false, slewing: false, canSetTracking: true, canUnpark: true })
      expect(await f.view()).toMatchObject({ unpark: { enabled: false }, trackingOn: { enabled: false } })
      expect((await f.post()).statusCode).toBe(409)
      f.setObservation({ parked: true, tracking: false, slewing: false, canSetTracking: true, canUnpark: true })
      expect(await f.view()).toMatchObject({ unpark: { enabled: true }, trackingOn: { enabled: false } })
      f.interrupt()
      expect((await f.post('unpark')).statusCode).toBe(409)
      expect(f.execute).not.toHaveBeenCalled()
    } finally { await f.app.close() }
  })

  it('does not chain tracking onto unpark or infer its tracking outcome', async () => {
    const f = fixture()
    f.setObservation({ parked: true, tracking: false, slewing: false, canSetTracking: true, canUnpark: true })
    f.execute.mockResolvedValue({ outcome: 'confirmed', observation: { parked: false, tracking: true, slewing: false } })

    try {
      expect((await f.post('unpark')).json()).toMatchObject({ command: { action: 'unpark', state: 'confirmed' } })
      expect(f.execute).toHaveBeenCalledExactlyOnceWith({ telescopeId: 'mount', expectedTelescopeName: 'Actual mount', kind: 'unpark' })
      f.setObservation({ parked: false, tracking: true, slewing: false, canSetTracking: true, canUnpark: true })
      expect(await f.deviceView()).toMatchObject({
        status: { tracking: 'on', parking: 'unparked' },
        mountControl: { trackingOff: { enabled: true }, trackingOn: { enabled: false } },
      })
    } finally { await f.app.close() }
  })
})
