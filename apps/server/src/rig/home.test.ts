import { describe, expect, it, vi } from 'vitest'
import type { RigDeviceInventory } from '../device/inventory.js'
import type { ObservedRigDevice } from '../device/model.js'
import { createMemoryRigCatalog } from './catalog.js'
import type { ObservedRigInventory, RigCatalogRecord } from './contracts.js'
import { loadHomeView } from './home.js'

function rig(id: string, uniqueId: string): RigCatalogRecord {
  return {
    id,
    name: `Rig ${id}`,
    endpoint: { host: `${id}.local`, port: 11111 },
    addedAt: '2026-09-01T19:00:00.000Z',
    lastObservedInventory: {
      observedAt: '2026-09-01T20:00:00.000Z',
      devices: [{ uniqueId, kind: 'camera', name: 'Prior camera' }],
    },
  }
}

describe('Home Rig projection', () => {
  it('refreshes reachable inventory and preserves last-known devices when a Rig is offline', async () => {
    const online = rig('online', 'camera-1')
    const offline = rig('offline', 'camera-2')
    const catalog = createMemoryRigCatalog([online, offline])
    const observedAt = new Date('2026-09-02T20:00:00.000Z')
    const currentDevice: ObservedRigDevice = {
      id: 'online-camera-1',
      rigId: 'online',
      uniqueId: 'camera-1',
      kind: 'camera',
      name: 'Current camera',
      driver: { version: '1.2.3' },
      connection: 'connected',
      status: { state: 'unknown' },
      observedAt,
    }
    const unavailable = new Error('provider unavailable')
    const onUnavailable = vi.fn()

    const home = await loadHomeView(catalog, {
      createInventory(source): RigDeviceInventory {
        return {
          async listDevices() {
            if (source.id === offline.id) throw unavailable
            return [currentDevice]
          },
        }
      },
      now: () => new Date('2026-09-02T20:01:00.000Z'),
      onUnavailable,
    })

    expect(home).toEqual({
      rigs: [
        {
          id: 'online',
          name: 'Rig online',
          reachability: 'reachable',
          lastSeenAt: '2026-09-02T20:00:00.000Z',
          connections: { total: 1, connected: 1, disconnected: 0, unavailable: 0 },
          capabilities: ['forget'],
        },
        {
          id: 'offline',
          name: 'Rig offline',
          reachability: 'unreachable',
          lastSeenAt: '2026-09-01T20:00:00.000Z',
          connections: { total: 1, connected: 0, disconnected: 0, unavailable: 1 },
          capabilities: ['forget'],
        },
      ],
      refreshedAt: '2026-09-02T20:01:00.000Z',
    })
    expect(onUnavailable).toHaveBeenCalledWith(offline, unavailable)
    await expect(catalog.list()).resolves.toEqual([
      {
        ...online,
        lastObservedInventory: {
          observedAt: '2026-09-02T20:00:00.000Z',
          devices: [{ uniqueId: 'camera-1', kind: 'camera', name: 'Current camera' }],
        },
      },
      offline,
    ])
  })

  it('preserves prior identity when an endpoint reports another Rig’s device', async () => {
    const rigA = rig('rig-a', 'camera-a')
    const rigB = rig('rig-b', 'camera-b')
    const catalog = createMemoryRigCatalog([rigA, rigB])
    const onConflict = vi.fn()

    const home = await loadHomeView(catalog, {
      createInventory(source): RigDeviceInventory {
        return {
          async listDevices() {
            if (source.id === rigB.id) throw new Error('offline')
            return [{
              id: 'rig-a-camera-b',
              rigId: 'rig-a',
              uniqueId: 'camera-b',
              kind: 'camera',
              name: 'Rig B camera',
              driver: {},
              connection: 'connected',
              status: { state: 'unknown' },
              observedAt: new Date('2026-09-02T20:00:00.000Z'),
            }]
          },
        }
      },
      onConflict,
    })

    expect(home.rigs[0]).toMatchObject({
      id: 'rig-a',
      reachability: 'unknown',
      connections: { total: 1, connected: 0, disconnected: 0, unavailable: 1 },
    })
    expect(onConflict).toHaveBeenCalledWith(rigA)
    await expect(catalog.list()).resolves.toEqual([rigA, rigB])
  })
})
