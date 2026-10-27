import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Device } from '@cria/wire'
import { createCriaConnection } from '../src/connection.js'
import { createCriaEquipment } from '../src/equipment.js'
import { FakeCria } from './v5/fake-cria.js'

let cria: FakeCria

let connection: ReturnType<typeof createCriaConnection>

let equipment: ReturnType<typeof createCriaEquipment>

const telescopeId = 'mount'

const home = { telescopeId, expectedTelescopeName: 'ZWO AM5', kind: 'home' } as const

const stop = { telescopeId, expectedTelescopeName: 'ZWO AM5', kind: 'stop' } as const

beforeEach(async () => {
  vi.useFakeTimers({ now: Date.UTC(2026, 9, 27, 3, 14) })
  cria = new FakeCria()
  connection = createCriaConnection({ origin: cria.origin, fetch: cria.fetch })
  equipment = createCriaEquipment(connection, [
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

/** Cria's state reaches Vela on its next one-second read; readings and the busy check wait for it. */
async function untilCriaIsRead() {
  await vi.advanceTimersByTimeAsync(1500)
}

function submitted() {
  return cria.received
    .filter(request => request.route === 'submit')
    .map(request => JSON.parse(request.body ?? '{}').kind as string)
}

function mountReadings(readings: Partial<Extract<Device, { kind: 'mount' }>['readings']>) {
  cria.deviceView = device => device.kind === 'mount' ? { ...device, readings: { ...device.readings, ...readings } } : device
}

describe('home', () => {
  it('reports whether the mount can find home', async () => {
    expect(await equipment.mountControl.observe(telescopeId)).toMatchObject({ canFindHome: true })
  })

  it('sends one mount-home, confirms it and remembers when', async () => {
    const homing = equipment.mountControl.execute(home)

    await vi.advanceTimersByTimeAsync(300)
    const result = await homing
    const at = expect.stringMatching(/^2026-10-27T03:14:/)

    await untilCriaIsRead()
    expect(submitted()).toEqual(['mount-home'])
    expect(result).toMatchObject({ outcome: 'confirmed', observation: { slewing: false, homeConfirmedAt: at } })
    expect(await equipment.mountControl.observe(telescopeId)).toMatchObject({ homeConfirmedAt: at })
  })

  it('is sent even when the mount may already be home, because the AM5 cannot say', async () => {
    for (let times = 0; times < 2; times++) {
      const homing = equipment.mountControl.execute(home)

      await vi.advanceTimersByTimeAsync(300)
      await homing
      await untilCriaIsRead()
    }

    expect(submitted()).toEqual(['mount-home', 'mount-home'])
  })

  it('refuses a parked mount without sending anything', async () => {
    mountReadings({ parked: { status: 'fresh', value: true, observedAt: Date.now() } } as never)
    await vi.advanceTimersByTimeAsync(1100)

    expect(await equipment.mountControl.execute(home)).toMatchObject({ outcome: 'failed', reason: 'parked' })
    expect(submitted()).toEqual([])
  })

  it('is forgotten by a slew through Vela, but not by a tracking change', async () => {
    const homing = equipment.mountControl.execute(home)

    await vi.advanceTimersByTimeAsync(300)
    await homing
    await untilCriaIsRead()

    const tracking = equipment.framing.setTracking(telescopeId, false)

    await untilCriaIsRead()
    await tracking
    expect(await equipment.mountControl.observe(telescopeId)).toHaveProperty('homeConfirmedAt')

    const slewing = equipment.framing.slew({ telescopeId, coordinateSystem: 'topocentric', rightAscensionDegrees: 10, declinationDegrees: 20 })

    await untilCriaIsRead()
    await slewing
    expect(await equipment.mountControl.observe(telescopeId)).not.toHaveProperty('homeConfirmedAt')
  })

  it('is also set by a home through the framing adapter', async () => {
    const framed = equipment.framing.home(telescopeId)

    await untilCriaIsRead()
    await framed
    expect(await equipment.mountControl.observe(telescopeId)).toHaveProperty('homeConfirmedAt')
  })

  it('is not remembered when the home is stopped, and the mount is not held', async () => {
    cria.durationMs['mount-home'] = 60_000
    const homing = equipment.mountControl.execute(home)

    await vi.advanceTimersByTimeAsync(300)
    const stopping = equipment.mountControl.execute(stop)

    await vi.advanceTimersByTimeAsync(300)

    expect(await stopping).toMatchObject({ outcome: 'confirmed' })
    expect(await homing).toMatchObject({ outcome: 'failed', reason: 'stopped' })
    await untilCriaIsRead()
    expect(submitted()).toEqual(['mount-home', 'mount-stop'])
    expect(equipment.holds()).toEqual([])
    expect(await equipment.mountControl.observe(telescopeId)).not.toHaveProperty('homeConfirmedAt')
  })

  it('reports an unconfirmed home as uncertain and leaves the mount held', async () => {
    cria.durationMs['mount-home'] = 60_000
    const homing = equipment.mountControl.execute(home)

    await vi.advanceTimersByTimeAsync(300)
    const state = await (await cria.fetch(`${cria.origin}/v2/state`)).json()

    cria.settle(state.operations[0].id, { kind: 'uncertain', reason: 'stop-not-confirmed', message: 'The mount did not stand still' })
    await vi.advanceTimersByTimeAsync(300)

    expect(await homing).toMatchObject({ outcome: 'uncertain', reason: 'write-outcome-unknown' })
    expect(equipment.holds().map(hold => hold.deviceId)).toEqual(['mount'])
    expect(await equipment.mountControl.observe(telescopeId)).toBeUndefined()
  })
})

describe('stop', () => {
  it('can be offered without readings', () => {
    expect(equipment.mountControl.canStop).toBe(true)
  })

  it('stops a slew and confirms the mount still', async () => {
    cria.durationMs['mount-slew'] = 60_000
    const slewing = equipment.framing.slew({ telescopeId, coordinateSystem: 'topocentric', rightAscensionDegrees: 10, declinationDegrees: 20 }).catch(() => 'stopped')

    await vi.advanceTimersByTimeAsync(300)
    const stopping = equipment.mountControl.execute(stop)

    await vi.advanceTimersByTimeAsync(300)

    expect(await stopping).toMatchObject({ outcome: 'confirmed', observation: { slewing: false } })
    expect(await slewing).toBe('stopped')
    expect(equipment.holds()).toEqual([])
  })

  it('reaches a held mount, because Cria admits a halt on a blocked device', async () => {
    cria.durationMs['mount-slew'] = 60_000
    const slewing = equipment.framing.slew({ telescopeId, coordinateSystem: 'topocentric', rightAscensionDegrees: 10, declinationDegrees: 20 }).catch(() => 'held')

    await vi.advanceTimersByTimeAsync(300)
    const state = await (await cria.fetch(`${cria.origin}/v2/state`)).json()

    cria.settle(state.operations[0].id, { kind: 'uncertain', reason: 'stop-not-confirmed', message: 'The mount did not stand still' })
    await vi.advanceTimersByTimeAsync(300)
    await slewing
    expect(equipment.holds().map(hold => hold.deviceId)).toEqual(['mount'])

    const stopping = equipment.mountControl.execute(stop)

    await vi.advanceTimersByTimeAsync(300)

    expect(await stopping).toMatchObject({ outcome: 'confirmed' })
    expect(submitted()).toEqual(['mount-slew', 'mount-stop'])
  })

  it('reports a stop Cria did not answer as uncertain and holds the mount, never confirmed', async () => {
    cria.reachable = false
    const stopping = equipment.mountControl.execute(stop)

    await vi.advanceTimersByTimeAsync(21_000)

    expect(await stopping).toMatchObject({ outcome: 'uncertain', reason: 'write-outcome-unknown' })
    expect(equipment.holds().map(hold => hold.deviceId)).toEqual(['mount'])
  })

  it('refuses a mount Vela is not bound to', async () => {
    expect(await equipment.mountControl.execute({ ...stop, telescopeId: 'camera' })).toEqual({ outcome: 'failed', reason: 'device-not-found' })
  })
})
