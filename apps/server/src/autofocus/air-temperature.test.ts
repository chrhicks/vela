import { expect, it } from 'vitest'
import type { RigDetailView, RigObservingConditionsStatus } from '@vela/model/web'
import { airTemperatureC } from './air-temperature.js'

type Device = RigDetailView['devices'][number]

type Observation = NonNullable<Device['observation']>

function conditions(id: string, temperatureC: number | undefined, observation?: Observation): Device {
  const status: RigObservingConditionsStatus = { availability: 'complete', activity: 'reporting' }

  const device: Device = {
    id,
    name: id,
    configuredName: id,
    kind: 'observing-conditions',
    connection: 'connected',
    observedAt: '2026-10-27T03:00:00.000Z',
    status: temperatureC === undefined ? status : { ...status, temperatureC },
  }

  return observation ? { ...device, observation } : device
}

it('reads the one connected observing-conditions device', () => {
  expect(airTemperatureC([conditions('ppba', 13.5)])).toBe(13.5)
  expect(airTemperatureC([conditions('ppba', 0)])).toBe(0)
})

it('is null when no device reports a temperature', () => {
  expect(airTemperatureC([])).toBeNull()
  expect(airTemperatureC([conditions('ppba', undefined)])).toBeNull()
})

it('is null for a last-known reading', () => {
  const stale = conditions('ppba', 9, { state: 'interrupted', commandReady: false })

  expect(airTemperatureC([stale])).toBeNull()
})

it('is null for a disconnected device', () => {
  const offline: Device = {
    id: 'ppba',
    name: 'ppba',
    configuredName: 'ppba',
    kind: 'observing-conditions',
    connection: 'disconnected',
    observedAt: '2026-10-27T03:00:00.000Z',
    status: { availability: 'unavailable' },
  }

  expect(airTemperatureC([offline])).toBeNull()
})

it('is null when two devices report, because the rig page cannot say which is the air', () => {
  expect(airTemperatureC([conditions('a', 5), conditions('b', 6)])).toBeNull()
})
