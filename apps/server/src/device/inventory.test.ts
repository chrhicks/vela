import { describe, expect, it } from 'vitest'
import type { AlpacaProvider } from '@vela/alpaca'
import { createRigDeviceInventory } from './inventory.js'
import { toDeviceSummary } from '../web/device.js'

const rig = {
  id: 'rig-1',
  endpoint: { host: 'alpaca.test', port: 11111 },
}

describe('Rig device inventory', () => {
  it('maps normalized provider devices into server models and web projections', async () => {
    const provider: AlpacaProvider = {
      async inspectDevices() {
        return []
      },
      async listDevices() {
        return [{
          providerDeviceId: 'camera-1',
          kind: 'camera',
          name: 'Main Camera',
          connection: 'connected',
          driver: { version: '1.2.3' },
        }]
      },
    }
    const observedAt = new Date('2026-08-21T12:00:00.000Z')
    const inventory = createRigDeviceInventory(rig, {
      provider,
      now: () => observedAt,
    })

    const devices = await inventory.listDevices()

    expect(devices).toEqual([{
      id: 'rig-1-camera-1',
      rigId: 'rig-1',
      uniqueId: 'camera-1',
      kind: 'camera',
      name: 'Main Camera',
      driver: { version: '1.2.3' },
      connection: 'connected',
      status: { state: 'unknown' },
      observedAt,
    }])
    expect(toDeviceSummary(devices[0]!)).toEqual({
      id: 'rig-1-camera-1',
      rigId: 'rig-1',
      kind: 'camera',
      name: 'Main Camera',
      driver: { version: '1.2.3' },
      connection: 'connected',
      status: { state: 'unknown' },
      updatedAt: '2026-08-21T12:00:00.000Z',
    })
  })
})
