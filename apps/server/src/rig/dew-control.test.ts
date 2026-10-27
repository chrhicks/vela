import Fastify from 'fastify'
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { EquipmentInspection, SwitchChannel, SwitchControl, SwitchSetResult } from '@vela/equipment'
import { createMemoryRigCatalog } from './catalog.js'
import { registerDewControls } from './dew-control.js'
import { loadRigDetailView } from './detail.js'

const channels = (auto = false, dutyA = 0): ReadonlyArray<SwitchChannel> => [
  { id: 0, name: '12V', on: true, value: 1 },
  { id: 1, name: 'Dew A duty (%)', value: dutyA, on: dutyA > 0 },
  { id: 2, name: 'Dew B duty (%)', value: 0, on: false },
  { id: 3, name: 'Auto dew', value: auto ? 1 : 0, on: auto },
  { id: 4, name: 'Dew A', value: 1, on: true },
  { id: 5, name: 'Dew B', value: 1, on: true },
]

function fixture(options: { source?: boolean } = {}) {
  const rig = {
    id: 'rig',
    name: 'Test rig',
    endpoint: { host: 'power.test', port: 11111 },
    addedAt: '2026-10-06T00:00:00.000Z',
    lastObservedInventory: {
      observedAt: '2026-10-06T00:00:00.000Z',
      devices: [{ uniqueId: 'power', kind: 'switch' as const, name: 'Power slot' }],
    },
  }

  let inspection: EquipmentInspection = {
    providerDeviceId: 'power',
    name: 'Fake PPB',
    configuredName: 'Power slot',
    kind: 'switch',
    connection: 'connected',
    observation: { state: 'current', commandReady: true },
    telemetry: { availability: 'complete', values: { kind: 'switch', channels: channels() } },
  }

  const catalog = createMemoryRigCatalog([rig])
  const inspectDevices = vi.fn(async () => [inspection])
  const createInspector = () => ({ inspectDevices })
  let hasControl = options.source !== false
  const set = vi.fn<SwitchControl['set']>(async () => ({ outcome: 'confirmed' }))
  const app = Fastify()

  const controls = registerDewControls(app, catalog, {
    createInspector,
    createSwitchControl: () => hasControl ? { set } : undefined,
  })

  async function deviceView() {
    const result = await loadRigDetailView(catalog, 'rig', { createInspector })

    if (result.state !== 'found') throw new Error('Missing fixture rig')
    const device = controls.decorate(result.view).devices[0]

    if (device?.kind !== 'switch') throw new Error('Missing fixture switch')

    return device
  }

  const dutyA = (percent: number) => ({ kind: 'duty', channelId: 1, percent }) as const

  const post = (action: Readonly<Record<string, string | number | boolean>> = dutyA(40), requestId: string = randomUUID(), deviceId = 'rig-power') => app.inject({
    method: 'POST', url: '/api/rigs/rig/dew', payload: { deviceId, requestId, serverInstanceId: controls.serverInstanceId, action },
  })

  const check = (requestId: string, serverInstanceId = controls.serverInstanceId) => app.inject({
    method: 'POST', url: '/api/rigs/rig/dew/check', payload: { deviceId: 'rig-power', requestId, serverInstanceId },
  })

  return {
    app, controls, set, inspectDevices, deviceView, view: async () => (await deviceView()).dewControl!, post, check, dutyA,
    show(next: ReadonlyArray<SwitchChannel>) {
      inspection = { ...inspection, telemetry: { availability: 'complete', values: { kind: 'switch', channels: next } } }
    },
    change(next: Partial<EquipmentInspection>) { inspection = { ...inspection, ...next } },
    withoutControl() { hasControl = false },
  }
}

describe('dew heater controls', () => {
  it('offers Auto dew and the dew duty channels and no other channel of the box', async () => {
    const f = fixture()

    try {
      const view = await f.view()

      expect(view.auto).toEqual({ on: false, set: { enabled: true, reason: null } })
      expect(view.channels.map(channel => [channel.id, channel.name, channel.dutyPercent])).toEqual([[1, 'Dew A duty (%)', 0], [2, 'Dew B duty (%)', 0]])
      expect((await f.post({ kind: 'duty', channelId: 0, percent: 1 })).json()).toEqual({ error: 'dew-channel-not-found' })
      expect((await f.post({ kind: 'duty', channelId: 3, percent: 1 })).json()).toEqual({ error: 'dew-channel-not-found' })
      expect((await f.post({ kind: 'duty', channelId: 4, percent: 40 })).json()).toEqual({ error: 'dew-channel-not-found' })
      expect(f.set).not.toHaveBeenCalled()
    } finally { await f.app.close() }
  })

  it('has no dew section for a switch without dew channels or a rig that cannot command one', async () => {
    const f = fixture()

    try {
      f.show([{ id: 0, name: '12V', on: true, value: 1 }])
      expect((await f.deviceView()).dewControl).toBeUndefined()
      f.show(channels())
      f.withoutControl()
      expect((await f.post()).json()).toMatchObject({ error: 'dew-unavailable' })
    } finally { await f.app.close() }
  })

  it('sets a fixed duty once, confirmed by the box, and never admits the same request twice', async () => {
    const f = fixture()
    const requestId = randomUUID()
    f.set.mockResolvedValueOnce({ outcome: 'confirmed', value: 39.8 })

    try {
      const response = await f.post(f.dutyA(40), requestId)

      expect(response.json()).toMatchObject({
        command: { requestId, action: f.dutyA(40), state: 'confirmed', message: 'The box holds 39.8%.' },
      })
      expect((await f.post(f.dutyA(40), requestId)).json()).toEqual({ error: 'dew-command-already-admitted' })
      expect(f.set).toHaveBeenCalledExactlyOnceWith({ switchId: 'power', expectedSwitchName: 'Fake PPB', channelId: 1, value: 40 })
    } finally { await f.app.close() }
  })

  it('turns Auto dew on and off by writing 1 and 0 to its channel', async () => {
    const f = fixture()

    try {
      expect((await f.post({ kind: 'auto', on: true })).json()).toMatchObject({ command: { state: 'confirmed' } })
      expect(f.set).toHaveBeenLastCalledWith(expect.objectContaining({ channelId: 3, value: 1 }))
      expect((await f.post({ kind: 'auto', on: false })).json()).toMatchObject({ command: { state: 'confirmed' } })
      expect(f.set).toHaveBeenLastCalledWith(expect.objectContaining({ channelId: 3, value: 0 }))
    } finally { await f.app.close() }
  })

  it('disables the fixed duty with "Auto dew is on" and refuses it without sending', async () => {
    const f = fixture()

    try {
      f.show(channels(true))
      const view = await f.view()

      expect(view.auto).toMatchObject({ on: true, set: { enabled: true } })
      expect(view.channels.map(channel => channel.set)).toEqual([
        { enabled: false, reason: 'Auto dew is on' },
        { enabled: false, reason: 'Auto dew is on' },
      ])
      expect((await f.post(f.dutyA(40))).json()).toEqual({ error: 'dew-command-unavailable', message: 'Auto dew is on' })
      expect(f.set).not.toHaveBeenCalled()
    } finally { await f.app.close() }
  })

  it('refuses values outside 0 to 100, fractions of nothing and unknown fields before anything is read', async () => {
    const f = fixture()

    try {
      for (const action of [
        f.dutyA(101), f.dutyA(-1), { kind: 'duty', channelId: 1, percent: '40' }, { kind: 'duty', channelId: 1.5, percent: 10 },
        { kind: 'duty', channelId: -1, percent: 10 }, { kind: 'auto', on: 1 }, { kind: 'auto', on: true, channelId: 0 }, { kind: 'raw', channelId: 0, value: 1 },
      ]) expect((await f.post(action)).statusCode).toBe(400)
      expect((await f.post(f.dutyA(0))).statusCode).toBe(200)
      expect((await f.post(f.dutyA(100))).statusCode).toBe(200)
      expect(f.set).toHaveBeenCalledTimes(2)
      expect((await f.post(f.dutyA(40), randomUUID(), 'power')).statusCode).toBe(404)
    } finally { await f.app.close() }
  })

  it('disables every control, with the reason, when the box is held or unread, and offers none when it is disconnected', async () => {
    const f = fixture()

    try {
      f.change({ observation: { state: 'current', commandReady: false, hold: { deviceId: 'power', reason: 'unknown outcome' } } })
      expect((await f.view()).channels[0]?.set).toEqual({ enabled: false, reason: 'The power box is held. Clear the hold first.' })
      f.change({ observation: { state: 'partial', commandReady: false } })
      expect((await f.view()).channels[0]?.set).toEqual({ enabled: false, reason: 'Fresh dew heater readings are unavailable.' })
      expect((await f.post()).statusCode).toBe(409)
      f.change({ connection: 'disconnected', observation: { state: 'current', commandReady: true }, telemetry: { availability: 'unavailable' } })
      expect((await f.deviceView()).dewControl).toBeUndefined()
      expect((await f.post()).statusCode).toBe(404)
      expect(f.set).not.toHaveBeenCalled()
    } finally { await f.app.close() }
  })

  it('shows a refusal from the box and leaves the next change free', async () => {
    const f = fixture()
    f.set.mockResolvedValueOnce({ outcome: 'failed', reason: 'rejected', message: 'Dew A is set automatically while Auto dew is on' })

    try {
      expect((await f.post()).json()).toMatchObject({ command: { state: 'failed', message: 'Dew A is set automatically while Auto dew is on' } })
      expect((await f.view()).channels[0]?.set.enabled).toBe(true)
    } finally { await f.app.close() }
  })

  it.each<[string, () => Promise<SwitchSetResult>]>([
    ['an unknown outcome', async () => ({ outcome: 'uncertain', reason: 'write-outcome-unknown' })],
    ['a failure to reach the adapter', async () => { throw new Error('socket closed') }],
  ])('keeps %s until fresh readings show the box, and never sends the change again', async (_, outcome) => {
    const f = fixture()
    f.set.mockImplementationOnce(outcome)

    try {
      const response = (await f.post(f.dutyA(40))).json()

      expect(response.command.state).toBe('uncertain')
      expect(response.channels[0].set.reason).toMatch(/uncertain/)
      f.change({ observation: { state: 'current', commandReady: false, hold: { deviceId: 'power', reason: 'unknown outcome' } } })
      expect((await f.post(f.dutyA(40))).statusCode).toBe(409)
      expect((await f.view()).command?.state).toBe('uncertain')
      f.show(channels(false, 39.8))
      f.change({ observation: { state: 'current', commandReady: true } })
      expect((await f.view()).command).toMatchObject({ state: 'confirmed' })
      expect((await f.view()).channels[0]?.set.enabled).toBe(true)
      expect(f.set).toHaveBeenCalledOnce()
    } finally { await f.app.close() }
  })

  it('does not claim the write won when fresh readings show another duty', async () => {
    const f = fixture()
    f.set.mockResolvedValueOnce({ outcome: 'uncertain', reason: 'write-outcome-unknown' })

    try {
      await f.post(f.dutyA(40))
      f.show(channels(false, 25))
      expect((await f.view()).command).toMatchObject({ state: 'failed', message: expect.stringMatching(/not reached/) })
    } finally { await f.app.close() }
  })

  it('refuses a second change while the first is in flight', async () => {
    const f = fixture()
    let finish!: () => void
    f.set.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ outcome: 'confirmed' }) }))

    try {
      const first = f.post(f.dutyA(40))
      await vi.waitFor(() => expect(f.set).toHaveBeenCalledOnce())
      expect((await f.view()).channels[0]?.set).toMatchObject({ enabled: false, reason: expect.stringMatching(/Waiting/) })
      expect((await f.post(f.dutyA(50))).json()).toMatchObject({ error: 'dew-command-unavailable' })
      finish()
      expect((await first).json().command.state).toBe('confirmed')
      expect(f.set).toHaveBeenCalledOnce()
    } finally { await f.app.close() }
  })

  it('retires an unseen request before a delayed original can pass admission, without a write', async () => {
    const f = fixture()
    const requestId = randomUUID()
    let finishInspection!: () => void
    f.inspectDevices.mockImplementationOnce(() => new Promise(resolve => {
      finishInspection = async () => resolve(await f.inspectDevices())
    }))

    try {
      const original = f.post(f.dutyA(40), requestId)
      await vi.waitFor(() => expect(f.inspectDevices).toHaveBeenCalledOnce())
      expect((await f.check(requestId)).json()).toMatchObject({ admission: 'not-admitted', control: { command: null } })
      finishInspection()
      expect((await original).json()).toEqual({ error: 'dew-command-retired' })
      expect(f.set).not.toHaveBeenCalled()
    } finally { await f.app.close() }
  })

  it('says a request admitted before a restart is unknown, and refuses new ones from the old page', async () => {
    const f = fixture()

    try {
      expect((await f.check(randomUUID(), randomUUID())).json()).toMatchObject({ admission: 'unknown' })

      const stale = await f.app.inject({
        method: 'POST', url: '/api/rigs/rig/dew',
        payload: { deviceId: 'rig-power', requestId: randomUUID(), serverInstanceId: randomUUID(), action: f.dutyA(10) },
      })

      expect(stale.json().error).toBe('dew-server-restarted')
      expect(f.set).not.toHaveBeenCalled()
    } finally { await f.app.close() }
  })
})
