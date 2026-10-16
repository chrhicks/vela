import { describe, expect, it, vi } from 'vitest'
import type { RigDetailView, RigObservationView } from '@vela/model/web'
import { FakeCria } from '../../../packages/cria/test/v5/fake-cria'
import { createCriaConnection, createCriaEquipment } from '../../../packages/cria/src/index'
import { buildApp } from '../../server/src/app'
import { createMemoryRigCatalog } from '../../server/src/rig/catalog'
import { isRigObservationView } from '../src/features/observation/validation'
import { isRigDetailView } from '../src/lib/view-validation'

describe('interrupted equipment responses', () => {
  it('preserves retained measurements through server routes and browser validation, then recovers', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 17, 3) })
    const service = new FakeCria()
    service.deviceView = device => device.kind === 'mount' ? {
      ...device,
      availability: { ready: false, reason: 'disconnected', message: 'Mount disconnected' },
      readings: { ...device.readings, connected: { status: 'fresh', value: false, observedAt: Date.now() } },
    } : device
    let now = Date.now()
    const connection = createCriaConnection({ origin: service.origin, fetch: service.fetch })

    const provider = createCriaEquipment(connection, [
      { id: 'camera', kind: 'camera', expectedName: 'Fake CCD', providerDeviceId: 'camera' },
      { id: 'mount', kind: 'mount', expectedName: 'ZWO AM5', providerDeviceId: 'mount' },
    ]).provider

    connection.start()
    await vi.advanceTimersByTimeAsync(10)
    const measuredAt = new Date(now).toISOString()

    const app = buildApp({
      rigCatalog: createMemoryRigCatalog([{
        id: 'rig-1',
        name: 'Cria rig',
        endpoint: { host: 'cria.fixture', port: 4319 },
        addedAt: measuredAt,
        lastObservedInventory: {
          observedAt: measuredAt,
          devices: [
            { uniqueId: 'camera', kind: 'camera', name: 'Fake CCD' },
            { uniqueId: 'mount', kind: 'telescope', name: 'ZWO AM5' },
          ],
        },
      }]),
      createInspector: () => provider,
      now: () => new Date(now),
    })

    async function views() {
      const detailResponse = await app.inject({ method: 'GET', url: '/api/web/rigs/rig-1' })
      const observationResponse = await app.inject({ method: 'GET', url: '/api/web/rigs/rig-1/observe' })
      expect(detailResponse.statusCode).toBe(200)
      expect(observationResponse.statusCode).toBe(200)

      const detail = detailResponse.json<RigDetailView>()
      const observation = observationResponse.json<RigObservationView>()
      expect(isRigDetailView(detail)).toBe(true)
      expect(isRigObservationView(observation)).toBe(true)

      // Your Rig adds command controls; preparation shares the same device observations.
      const observedDetail = {
        ...detail,
        devices: detail.devices.map(device => {
          if (device.kind !== 'telescope') return device
          const { mountControl: _mountControl, ...observed } = device

          return observed
        }),
      }

      expect(observation.rig).toEqual(observedDetail)

      return { detail, observation }
    }

    try {
      const current = await views()
      expect(current.detail.connections).toEqual({ total: 2, connected: 1, disconnected: 1, unavailable: 0 })
      expect(current.observation.connectionPreparation.state).toBe('available')

      service.reachable = false
      await vi.advanceTimersByTimeAsync(3100)
      now += 30_000
      const retained = await views()
      expect(retained.detail).toMatchObject({
        state: 'needs-attention',
        refreshedAt: new Date(now).toISOString(),
        connections: { total: 2, connected: 0, disconnected: 0, unavailable: 2 },
        devices: [
          {
            connection: 'connected',
            observedAt: measuredAt,
            observation: { state: 'interrupted', observedAt: measuredAt, commandReady: false },
            status: { sensorTemperatureC: -10 },
          },
          { connection: 'disconnected', observation: { state: 'interrupted', commandReady: false } },
        ],
      })
      expect(retained.observation.connectionPreparation).toEqual({ state: 'unavailable', capabilities: [] })
      expect(retained.detail.devices[0]?.observation?.message).toEqual(expect.any(String))

      service.reachable = true
      await vi.advanceTimersByTimeAsync(2000)
      const recovered = await views()
      expect(recovered.detail.connections).toEqual(current.detail.connections)
      expect(recovered.observation.connectionPreparation.state).toBe('available')
    } finally {
      await app.close()
      await connection.close()
      service.close()
      vi.useRealTimers()
    }
  })
})
