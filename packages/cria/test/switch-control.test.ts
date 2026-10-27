import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCriaConnection } from '../src/connection.js'
import { createCriaEquipment } from '../src/equipment.js'
import { FakeCria } from './v5/fake-cria.js'

let cria: FakeCria

let connection: ReturnType<typeof createCriaConnection>

let equipment: ReturnType<typeof createCriaEquipment>

const switchId = 'switch'

const dewA = { switchId, expectedSwitchName: 'Fake PPB', channelId: 0 }

const autoDew = { switchId, expectedSwitchName: 'Fake PPB', channelId: 2 }

beforeEach(async () => {
  vi.useFakeTimers({ now: Date.UTC(2026, 9, 27, 3, 14) })
  cria = new FakeCria()
  connection = createCriaConnection({ origin: cria.origin, fetch: cria.fetch })
  equipment = createCriaEquipment(connection, [
    { providerDeviceId: 'switch', id: 'switch', kind: 'switch', expectedName: 'Fake PPB' },
    { providerDeviceId: 'mount', id: 'mount', kind: 'mount', expectedName: 'ZWO AM5' },
  ])
  connection.start()
  await vi.advanceTimersByTimeAsync(10)
})

afterEach(async () => {
  await connection.close()
  cria.close()
  vi.useRealTimers()
})

function submitted() {
  return cria.received
    .filter(request => request.route === 'submit')
    .map(request => {
      const sent: { kind: string; parameters: unknown } = JSON.parse(request.body ?? '{}')

      return { kind: sent.kind, parameters: sent.parameters }
    })
}

describe('switch control', () => {
  it('sends one switch-set and confirms with the value the device holds', async () => {
    const set = equipment.switchControl.set({ ...dewA, value: 40 })

    await vi.advanceTimersByTimeAsync(300)
    expect(await set).toEqual({ outcome: 'confirmed', value: 40 })
    expect(submitted()).toEqual([{ kind: 'switch-set', parameters: { channelId: 0, value: 40 } }])
  })

  it('reports a refusal from Cria with its own message and sends once', async () => {
    cria.setSwitch(2, 1)
    const set = equipment.switchControl.set({ ...dewA, value: 40 })

    await vi.advanceTimersByTimeAsync(300)
    expect(await set).toEqual({
      outcome: 'failed',
      reason: 'rejected',
      message: 'Dew A duty (%) is set automatically while Auto dew is on; switch Auto dew (channel 2) off first',
    })
    expect(submitted()).toHaveLength(1)
  })

  it('turns Auto dew off and then takes a duty', async () => {
    cria.setSwitch(2, 1)

    for (const command of [{ ...autoDew, value: 0 }, { ...dewA, value: 30 }]) {
      const set = equipment.switchControl.set(command)

      await vi.advanceTimersByTimeAsync(1500)
      expect(await set).toMatchObject({ outcome: 'confirmed' })
    }
  })

  it('carries each channel\'s range and step from Cria into the inspection', async () => {
    const [inspection] = (await equipment.provider.inspectDevices()).filter(device => device.providerDeviceId === 'switch')
    const channels = inspection?.telemetry?.values?.kind === 'switch' ? inspection.telemetry.values.channels : undefined

    expect(channels?.map(channel => [channel.id, channel.minimum, channel.maximum, channel.step])).toEqual([[0, 0, 100, 10], [1, 0, 100, 10], [2, 0, 1, 1]])
  })

  it('refuses a duty off the channel step with Cria\'s message and writes nothing, then takes 40', async () => {
    const off = equipment.switchControl.set({ ...dewA, value: 25 })

    await vi.advanceTimersByTimeAsync(300)
    expect(await off).toEqual({ outcome: 'failed', reason: 'rejected', message: 'Dew A duty (%) accepts 0-100 in steps of 10' })
    expect(cria.switchValue(0)).toBe(0)

    const on = equipment.switchControl.set({ ...dewA, value: 40 })

    await vi.advanceTimersByTimeAsync(300)
    expect(await on).toEqual({ outcome: 'confirmed', value: 40 })
    expect(cria.switchValue(0)).toBe(40)
  })

  it('does not send for a device that is not a configured switch or has another name', async () => {
    expect(await equipment.switchControl.set({ switchId: 'mount', channelId: 0, value: 1 })).toEqual({ outcome: 'failed', reason: 'device-not-found' })
    expect(await equipment.switchControl.set({ ...dewA, expectedSwitchName: 'Other box', value: 1 })).toEqual({ outcome: 'failed', reason: 'device-not-found' })
    expect(submitted()).toEqual([])
  })

  it('finds the outcome of a write whose reply was lost by looking the request up, and never sends it again', async () => {
    cria.dropReply('submit')
    const set = equipment.switchControl.set({ ...dewA, value: 40 })

    await vi.advanceTimersByTimeAsync(30_000)
    expect(await set).toEqual({ outcome: 'confirmed', value: 40 })
    expect(submitted()).toEqual([{ kind: 'switch-set', parameters: { channelId: 0, value: 40 } }])
  })
})
