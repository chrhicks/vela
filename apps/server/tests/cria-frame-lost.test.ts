import Fastify from 'fastify'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { CriaClient } from '@vela/cria'
import { FrameLostError } from '@vela/equipment'
import { ServiceFixture, serviceOrigin, token } from '../../../packages/cria/test/fixture.js'
import { createCriaEquipment } from '../src/cria/equipment.js'
import { registerCapture } from '../src/capture/routes.js'
import { createMemoryRigCatalog } from '../src/rig/catalog.js'
import { createRigOperations } from '../src/rig/operations.js'

// Cria has dropped the image by the time Vela fetches it.
function equipmentWithImageGone(service: ServiceFixture) {
  const bindings = service.state.devices.map(device => ({
    id: device.id,
    kind: device.kind,
    expectedName: device.expectedName,
    providerDeviceId: device.id,
  }))

  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (String(input instanceof Request ? input.url : input).endsWith('/original')) service.images.clear()

    return service.fetch(input, init)
  }

  const client = new CriaClient({
    baseUrl: serviceOrigin,
    token,
    devices: bindings.map(({ id, kind, expectedName }) => ({ id, kind, expectedName })),
    fetch,
    pollIntervalMs: 1,
    operationTimeoutMs: 1000,
  })

  onTestFinished(() => client.close())

  return createCriaEquipment(client, bindings)
}

describe('Cria frame lost before it is fetched', () => {
  it('reports a lost frame without another exposure', async () => {
    const service = new ServiceFixture()
    const adapter = equipmentWithImageGone(service)

    await expect(adapter.acquisition.capture({
      cameraId: 'camera',
      expectedCameraName: service.camera.expectedName,
      exposureSeconds: 1,
    })).rejects.toBeInstanceOf(FrameLostError)

    expect(service.posts).toHaveLength(1)
  })

  it('ends a single exposure through the real route and says the frame was lost', async () => {
    const service = new ServiceFixture()
    const adapter = equipmentWithImageGone(service)
    const app = Fastify()

    const catalog = createMemoryRigCatalog([{
      id: 'fixture',
      name: 'Fixture',
      endpoint: { host: 'unused.invalid', port: 11111 },
      imagingCamera: { uniqueId: 'camera', name: 'Fixture camera' },
      addedAt: '2026-10-12T12:00:00.000Z',
      lastObservedInventory: {
        observedAt: '2026-10-12T12:00:00.000Z',
        devices: [{ uniqueId: 'camera', kind: 'camera', name: 'Fixture camera' }],
      },
    }])

    registerCapture(app, catalog, createRigOperations(), {
      createAcquisition: () => adapter.acquisition,
      createCooling: () => adapter.cooling,
      createInspector: () => ({ inspectDevices: async () => [{
        providerDeviceId: 'camera',
        configuredName: 'Fixture camera',
        name: 'Fixture camera',
        kind: 'camera',
        connection: 'connected',
        telemetry: { availability: 'complete', values: { kind: 'camera', activity: 'idle' } },
      }] }),
    })

    try {
      const start = await app.inject({
        method: 'POST', url: '/api/rigs/fixture/capture/start', payload: { exposureSeconds: 1, repeat: false },
      })

      expect(start.statusCode).toBe(200)

      await vi.waitFor(async () => {
        const view = (await app.inject('/api/web/rigs/fixture/capture')).json()

        expect(view).toMatchObject({ active: false, phase: 'failed', lostFrameCount: 1, completedCount: 0 })
        expect(view.error).toContain('frame is lost')
      })

      expect(service.posts).toHaveLength(1)
    } finally {
      await app.close()
    }
  })
})
