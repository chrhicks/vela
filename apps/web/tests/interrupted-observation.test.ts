import { describe, expect, it, vi } from 'vitest'
import type { RigDetailView, RigObservationView } from '@vela/model/web'
import { ServiceFixture, reading, serverNow } from '../../../packages/cria/test/fixture'
import { buildApp } from '../../server/src/app'
import { createCriaProvider } from '../../server/src/cria/provider'
import { createMemoryRigCatalog } from '../../server/src/rig/catalog'
import { isRigObservationView } from '../src/features/observation/validation'
import { isRigDetailView } from '../src/lib/view-validation'

describe('interrupted equipment responses', () => {
  it('preserves retained measurements through server routes and browser validation, then recovers', async () => {
    const service = new ServiceFixture()
    service.camera.fields.temperatureC = reading(-10)
    service.mount.fields.connected = reading(false)
    let interrupted = false
    let now = serverNow

    const client = service.client({
      fetch: async (input, init) => {
        if (interrupted) throw new Error('Connection interrupted')

        return service.fetch(input, init)
      },
    })

    const bindings = service.state.devices.map(device => ({
      id: device.id,
      kind: device.kind,
      expectedName: device.expectedName,
      providerDeviceId: device.id,
    }))

    const provider = createCriaProvider(client, bindings)
    const measuredAt = new Date(serverNow).toISOString()

    const app = buildApp({
      rigCatalog: createMemoryRigCatalog([{
        id: 'rig-1',
        name: 'Cria rig',
        endpoint: { host: 'cria.fixture', port: 4319 },
        addedAt: measuredAt,
        lastObservedInventory: {
          observedAt: measuredAt,
          devices: [
            { uniqueId: 'camera', kind: 'camera', name: 'Fixture camera' },
            { uniqueId: 'mount', kind: 'telescope', name: 'Fixture mount' },
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
      expect(observation.rig).toEqual(detail)

      return { detail, observation }
    }

    try {
      const current = await views()
      expect(current.detail.connections).toEqual({ total: 2, connected: 1, disconnected: 1, unavailable: 0 })
      expect(current.observation.connectionPreparation.state).toBe('available')

      interrupted = true
      service.interrupt()
      await vi.waitFor(async () => expect(client.state()).rejects.toMatchObject({ reason: 'transport' }))
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

      interrupted = false
      await vi.waitFor(async () => expect((await client.state()).state.instanceId).toBe(service.state.instanceId))
      const recovered = await views()
      expect(recovered.detail.connections).toEqual(current.detail.connections)
      expect(recovered.observation.connectionPreparation.state).toBe('available')
    } finally {
      await app.close()
      await client.close()
    }
  })
})
