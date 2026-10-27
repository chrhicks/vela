import Fastify from 'fastify'
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { EquipmentInspection, MountControl, MountControlCommandResult, MountControlObservation } from '@vela/equipment'
import { createMemoryRigCatalog } from './catalog.js'
import { createRigOperations } from './operations.js'
import { registerMountControls } from './mount-control.js'
import { loadRigDetailView } from './detail.js'

const homeConfirmedAt = '2026-10-27T03:14:00.000Z'

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
    parked: false, tracking: false, slewing: false, canSetTracking: true, canUnpark: true, canFindHome: true,
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

  let canStop = true

  const execute = vi.fn<MountControl['execute']>(async command => {
    if (command.kind === 'stop') return { outcome: 'confirmed', observation: { slewing: false } }

    if (command.kind === 'home') observation = { ...observation, homeConfirmedAt: homeConfirmedAt, slewing: false }
    else observation = command.kind === 'unpark' ? { ...observation, parked: false } : { ...observation, tracking: command.tracking }

    return { outcome: 'confirmed', observation }
  })

  const app = Fastify()

  const controls = registerMountControls(app, catalog, operations, {
    createInspector,
    createMountControl: () => ({ canStop, observe: async () => observation, execute }),
  })

  async function deviceView() {
    const result = await loadRigDetailView(catalog, 'rig', { createInspector })

    if (result.state !== 'found') throw new Error('Missing fixture rig')
    const detail = await controls.decorate(result.view)
    const mount = detail.devices[0]

    if (mount?.kind !== 'telescope') throw new Error('Missing fixture mount')

    return mount
  }

  const stop = (deviceId = 'rig-mount') => app.inject({ method: 'POST', url: '/api/rigs/rig/mount/stop', payload: { deviceId } })

  const post = (action = 'tracking-on', deviceId = 'rig-mount', requestId = randomUUID()) => app.inject({
    method: 'POST', url: '/api/rigs/rig/mount', payload: { action, deviceId, requestId, serverInstanceId: controls.serverInstanceId },
  })

  return {
    app, serverInstanceId: controls.serverInstanceId, inspectDevices, deviceView, view: async () => (await deviceView()).mountControl!, execute, post, stop, operations,
    setCanStop(value: boolean) { canStop = value },
    disconnect() { inspection = { ...inspection, connection: 'disconnected' } },
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

describe('home', () => {
  it('is offered on an idle unparked mount that can find home, with the reason when it is not', async () => {
    const f = fixture()

    try {
      expect(await f.view()).toMatchObject({ home: { enabled: true }, homeConfirmedAt: null })
      f.setObservation({ parked: true, tracking: false, slewing: false, canSetTracking: true, canUnpark: true, canFindHome: true })
      expect((await f.view()).home).toEqual({ enabled: false, reason: 'Unpark the mount before homing.' })
      f.setObservation({ parked: false, tracking: false, slewing: false, canSetTracking: true, canUnpark: true })
      expect((await f.view()).home).toEqual({ enabled: false, reason: 'This mount does not report home support.' })
      f.setObservation({ parked: false, tracking: true, slewing: true, canFindHome: true })
      expect((await f.view()).home).toEqual({ enabled: false, reason: 'Wait for the mount to stop slewing.' })
      expect((await f.post('home')).statusCode).toBe(409)
      expect(f.execute).not.toHaveBeenCalled()
    } finally { await f.app.close() }
  })

  it('is disabled with the reason while another feature holds the rig', async () => {
    const f = fixture()
    f.operations.acquire('rig', 'capture')

    try {
      expect((await f.view()).home.enabled).toBe(false)
      expect((await f.post('home')).statusCode).toBe(409)
      expect(f.execute).not.toHaveBeenCalled()
    } finally { await f.app.close() }
  })

  it('sends one home, shows it pending to every browser, then reports when it was confirmed', async () => {
    const f = fixture()
    let finish!: (value: MountControlCommandResult) => void
    f.execute.mockImplementation(() => new Promise(resolve => { finish = resolve }))

    try {
      const pending = f.post('home')
      await vi.waitFor(() => expect(f.execute).toHaveBeenCalledOnce())
      expect(f.execute).toHaveBeenCalledWith({ telescopeId: 'mount', expectedTelescopeName: 'Actual mount', kind: 'home' })
      expect(await f.view()).toMatchObject({ command: { action: 'home', state: 'pending' }, home: { enabled: false } })
      finish({ outcome: 'confirmed', observation: { parked: false, tracking: false, slewing: false, canFindHome: true, homeConfirmedAt } })
      expect((await pending).json()).toMatchObject({ command: { action: 'home', state: 'confirmed', message: null }, homeConfirmedAt })
      expect(f.operations.owner('rig')).toBeUndefined()
    } finally { await f.app.close() }
  })

  it('keeps showing the confirmed home from the next fresh reading, and not once the adapter forgets it', async () => {
    const f = fixture()

    try {
      await f.post('home')
      expect(await f.view()).toMatchObject({ homeConfirmedAt })
      f.setObservation({ parked: false, tracking: false, slewing: false, canFindHome: true })
      expect((await f.view()).homeConfirmedAt).toBeNull()
    } finally { await f.app.close() }
  })

  it('reports a home a Stop ended as failed, releases the rig and holds nothing', async () => {
    const f = fixture()
    let finish!: (value: MountControlCommandResult) => void
    f.execute.mockImplementation(command => command.kind === 'stop'
      ? Promise.resolve({ outcome: 'confirmed', observation: { slewing: false } })
      : new Promise(resolve => { finish = resolve }))

    try {
      const home = f.post('home')
      await vi.waitFor(() => expect(f.execute).toHaveBeenCalledOnce())
      expect((await f.stop()).json()).toEqual({ outcome: 'confirmed', message: null })
      finish({ outcome: 'failed', reason: 'stopped', message: 'Homing was stopped.' })
      expect((await home).json()).toMatchObject({ command: { action: 'home', state: 'failed', message: 'Homing was stopped.' } })
      expect(f.operations.owner('rig')).toBeUndefined()
      expect((await f.view()).home.enabled).toBe(true)
    } finally { await f.app.close() }
  })

  it('never calls an unknown home confirmed: an idle mount after it resolves to failed, without replay', async () => {
    const f = fixture()
    f.execute.mockResolvedValue({ outcome: 'uncertain', reason: 'write-outcome-unknown', message: 'Cria lost the home' })

    try {
      expect((await f.post('home')).json()).toMatchObject({ command: { action: 'home', state: 'uncertain' } })
      f.setObservation({ parked: false, tracking: false, slewing: true, canFindHome: true })
      expect(await f.view()).toMatchObject({ command: { state: 'uncertain' } })
      f.setObservation({ parked: false, tracking: false, slewing: false, canFindHome: true })

      expect(await f.view()).toMatchObject({
        command: { action: 'home', state: 'failed', message: expect.stringContaining('Home is not confirmed') },
        homeConfirmedAt: null,
        home: { enabled: true },
      })
      expect(f.execute).toHaveBeenCalledOnce()
    } finally { await f.app.close() }
  })
})

describe('stop', () => {
  it('sends one stop to the mount, with no request ID and no rig operation', async () => {
    const f = fixture()

    try {
      expect((await f.stop()).json()).toEqual({ outcome: 'confirmed', message: null })
      expect(f.execute).toHaveBeenCalledExactlyOnceWith({ kind: 'stop', telescopeId: 'mount', expectedTelescopeName: 'Mount slot' })
      expect(f.operations.owner('rig')).toBeUndefined()
      expect((await f.view()).command).toBeNull()
    } finally { await f.app.close() }
  })

  it('is offered whenever the mount could be moving, and says why when it is known to be still', async () => {
    const f = fixture()

    try {
      expect((await f.view()).stop).toEqual({ enabled: false, reason: 'The mount is not moving.' })
      f.setObservation({ parked: false, tracking: true, slewing: false })
      expect((await f.view()).stop.enabled).toBe(true)
      f.setObservation({ parked: false, tracking: false, slewing: true })
      expect((await f.view()).stop.enabled).toBe(true)
      f.setObservation({ parked: false, tracking: false })
      expect((await f.view()).stop.enabled).toBe(true)
      f.setObservation(undefined)
      expect((await f.view()).stop.enabled).toBe(true)
      f.setObservation({ parked: true, tracking: false, slewing: false })
      expect((await f.view()).stop).toEqual({ enabled: false, reason: 'The mount is parked.' })
    } finally { await f.app.close() }
  })

  it('is disabled for a mount that is not connected or that Vela cannot stop', async () => {
    const f = fixture()

    try {
      f.setObservation({ parked: false, tracking: true, slewing: true })
      f.setCanStop(false)
      expect((await f.view()).stop.enabled).toBe(false)
      expect((await f.stop()).statusCode).toBe(409)
      f.setCanStop(true)
      f.disconnect()
      expect((await f.view()).stop).toEqual({ enabled: false, reason: 'Connect the mount before stopping it.' })
      expect(f.execute).not.toHaveBeenCalled()
    } finally { await f.app.close() }
  })

  it('is not blocked by a pending command of the panel, an uncertain one or another feature holding the rig', async () => {
    const f = fixture()
    f.execute.mockImplementation(command => command.kind === 'stop'
      ? Promise.resolve({ outcome: 'confirmed', observation: { slewing: false } })
      : new Promise(() => {}))

    try {
      void f.post('tracking-on')
      await vi.waitFor(() => expect(f.execute).toHaveBeenCalledOnce())
      expect((await f.view()).stop.enabled).toBe(true)
      expect((await f.stop()).json()).toEqual({ outcome: 'confirmed', message: null })
      expect(f.operations.owner('rig')).toBe('mount-control')
    } finally { await f.app.close() }

    const held = fixture()
    held.operations.acquire('rig', 'alignment')

    try {
      expect((await held.stop()).json()).toEqual({ outcome: 'confirmed', message: null })
      expect(held.execute).toHaveBeenCalledOnce()
    } finally { await held.app.close() }
  })

  it('does not need the server instance, so a restarted Vela can still stop the mount', async () => {
    const f = fixture()

    try {
      expect((await f.app.inject({ method: 'POST', url: '/api/rigs/rig/mount/stop', payload: { deviceId: 'rig-mount', serverInstanceId: randomUUID() } })).statusCode).toBe(400)
      expect((await f.stop()).statusCode).toBe(200)
    } finally { await f.app.close() }
  })

  it('refuses a request for a mount the rig does not have', async () => {
    const f = fixture()

    try {
      expect((await f.stop('mount')).statusCode).toBe(404)
      expect((await f.app.inject({ method: 'POST', url: '/api/rigs/missing/mount/stop', payload: { deviceId: 'rig-mount' } })).statusCode).toBe(404)
      expect((await f.app.inject({ method: 'POST', url: '/api/rigs/rig/mount/stop', payload: {} })).statusCode).toBe(400)
      expect(f.execute).not.toHaveBeenCalled()
    } finally { await f.app.close() }
  })

  it('reports what Cria did not confirm, never a confirmed stop', async () => {
    const f = fixture()

    try {
      f.execute.mockResolvedValueOnce({ outcome: 'uncertain', reason: 'write-outcome-unknown', message: 'Cria did not answer mount-stop within 20 seconds' })
      expect((await f.stop()).json()).toEqual({ outcome: 'uncertain', message: 'Cria did not answer mount-stop within 20 seconds' })
      f.execute.mockResolvedValueOnce({ outcome: 'failed', reason: 'rejected' })
      expect((await f.stop()).json()).toMatchObject({ outcome: 'failed', message: expect.stringContaining('did not confirm') })
      f.execute.mockRejectedValueOnce(new Error('boom'))
      expect((await f.stop()).json()).toMatchObject({ outcome: 'uncertain' })
    } finally { await f.app.close() }
  })
})

