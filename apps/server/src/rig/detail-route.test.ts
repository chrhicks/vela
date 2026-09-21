import { describe, expect, it } from 'vitest'
import { buildApp } from '../app.js'
import { createMemoryRigCatalog } from './catalog.js'

const record = {
  id: 'rig-1',
  name: 'Backyard rig',
  endpoint: { host: 'ascom-remote.local', port: 11111 },
  addedAt: '2026-09-01T20:00:00.000Z',
  lastObservedInventory: {
    observedAt: '2026-09-02T20:00:00.000Z',
    devices: [{ uniqueId: 'camera-0', kind: 'camera' as const, name: 'Camera slot' }],
  },
}

describe('Rig detail API', () => {
  it('returns one known Rig and rejects unknown IDs', async () => {
    const app = buildApp({
      rigCatalog: createMemoryRigCatalog([record]),
      createInspector: () => ({
        async inspectDevices() {
          return [
            {
              providerDeviceId: 'camera-0',
              kind: 'camera',
              configuredName: 'Camera slot',
              name: 'Main camera',
              connection: 'connected',
              telemetry: {
                availability: 'complete',
                values: { kind: 'camera', activity: 'idle' },
              },
            },
          ]
        },
      }),
      now: () => new Date('2026-09-03T20:00:00.000Z'),
    })

    try {
      const known = await app.inject({ method: 'GET', url: '/api/web/rigs/rig-1' })
      expect(known.statusCode).toBe(200)
      expect(known.json()).toMatchObject({
        id: 'rig-1',
        state: 'reachable',
        devices: [{ id: 'rig-1-camera-0', status: { activity: 'idle' } }],
      })

      const unknown = await app.inject({ method: 'GET', url: '/api/web/rigs/unknown' })
      expect(unknown.statusCode).toBe(404)
      expect(unknown.json()).toEqual({ error: 'rig-not-found' })
    } finally {
      await app.close()
    }
  })
})
