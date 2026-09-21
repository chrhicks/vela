import { describe, expect, it, vi } from 'vitest'
import { AlpacaProviderError, type AlpacaDiscovery, type AlpacaInspection } from '@vela/alpaca'
import { buildApp } from '../app.js'
import { createMemoryRigCatalog } from './catalog.js'

const endpoint = { host: 'ascom-remote.local', port: 11111 }

function inspection(devices: AlpacaInspection['devices']): AlpacaInspection {
  return {
    endpoint,
    apiVersions: [1],
    server: { name: 'ASCOM Remote' },
    devices,
  }
}

describe('Rig management API', () => {
  it('re-inspects and adds a Rig once, then forgets it', async () => {
    const inspect = vi.fn<AlpacaDiscovery['inspect']>().mockResolvedValue(
      inspection([
        {
          providerDeviceId: 'camera-1',
          kind: 'camera',
          name: 'Main camera',
        },
      ]),
    )

    const catalog = createMemoryRigCatalog([], {
      createId: () => 'rig-1',
      now: () => new Date('2026-09-02T20:00:00.000Z'),
    })

    const app = buildApp({
      alpacaDiscovery: {
        async scan() {
          return []
        },
        inspect,
      },
      rigCatalog: catalog,
      now: () => new Date('2026-09-02T19:59:00.000Z'),
    })

    try {
      const added = await app.inject({
        method: 'POST',
        url: '/api/rigs',
        payload: { name: ' Backyard rig ', endpoint },
      })

      expect(added.statusCode).toBe(201)
      expect(added.json()).toEqual({ rigId: 'rig-1' })
      await expect(catalog.list()).resolves.toEqual([
        {
          id: 'rig-1',
          name: 'Backyard rig',
          endpoint,
          addedAt: '2026-09-02T20:00:00.000Z',
          lastObservedInventory: {
            observedAt: '2026-09-02T19:59:00.000Z',
            devices: [{ uniqueId: 'camera-1', kind: 'camera', name: 'Main camera' }],
          },
        },
      ])

      const duplicate = await app.inject({
        method: 'POST',
        url: '/api/rigs',
        payload: { name: 'Duplicate', endpoint },
      })

      expect(duplicate.statusCode).toBe(409)
      expect(duplicate.json()).toEqual({ error: 'rig-already-added', rigId: 'rig-1' })
      expect(inspect).toHaveBeenCalledTimes(2)

      expect((await app.inject({ method: 'DELETE', url: '/api/rigs/rig-1' })).statusCode).toBe(204)
      expect((await app.inject({ method: 'DELETE', url: '/api/rigs/rig-1' })).statusCode).toBe(404)
      await expect(catalog.list()).resolves.toEqual([])
    } finally {
      await app.close()
    }
  })

  it('rejects invalid additions and candidates without a stable device ID', async () => {
    const inspect = vi
      .fn<AlpacaDiscovery['inspect']>()
      .mockResolvedValue(inspection([{ kind: 'camera', name: 'Legacy camera' }]))

    const app = buildApp({
      alpacaDiscovery: {
        async scan() {
          return []
        },
        inspect,
      },
    })

    try {
      const invalid = await app.inject({
        method: 'POST',
        url: '/api/rigs',
        payload: { name: '', endpoint },
      })

      expect(invalid.statusCode).toBe(400)
      expect(inspect).not.toHaveBeenCalled()

      const ineligible = await app.inject({
        method: 'POST',
        url: '/api/rigs',
        payload: { name: 'Legacy rig', endpoint },
      })

      expect(ineligible.statusCode).toBe(422)
      expect(ineligible.json()).toEqual({ error: 'no-stable-device-id' })
    } finally {
      await app.close()
    }
  })

  it('reports an inspection failure without changing the catalog', async () => {
    const catalog = createMemoryRigCatalog()

    const app = buildApp({
      alpacaDiscovery: {
        async scan() {
          return []
        },
        async inspect() {
          throw new AlpacaProviderError('Unavailable', {
            reason: 'transport',
            endpoint: '/management/apiversions',
          })
        },
      },
      rigCatalog: catalog,
    })

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/rigs',
        payload: { name: 'Backyard rig', endpoint },
      })

      expect(response.statusCode).toBe(502)
      expect(response.json()).toEqual({ error: 'rig-inspection-failed' })
      await expect(catalog.list()).resolves.toEqual([])
    } finally {
      await app.close()
    }
  })
})
