import Fastify from 'fastify'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { CriaClient } from '@vela/cria'
import { FramingStoppedError } from '@vela/equipment'
import { ServiceFixture, serviceOrigin, token } from '../../../packages/cria/test/fixture.js'
import { createCriaEquipment } from '../src/cria/equipment.js'
import { createCriaCustody } from '../src/cria/custody.js'
import { createMemoryAcquisitionArchive } from '../src/acquisitions/archive.js'
import { registerCapture } from '../src/capture/routes.js'
import { createMemoryRigCatalog } from '../src/rig/catalog.js'
import { createRigOperations } from '../src/rig/operations.js'
import { createAlignmentController } from '../src/alignment/controller.js'

function equipment(service: ServiceFixture, fetch = service.fetch) {
  const bindings = service.state.devices.map(device => ({
    id: device.id,
    kind: device.kind,
    expectedName: device.expectedName,
    providerDeviceId: device.id,
  }))

  const client = new CriaClient({
    baseUrl: serviceOrigin,
    token,
    storeId: service.state.storeId,
    devices: bindings.map(({ id, kind, expectedName }) => ({ id, kind, expectedName })),
    fetch,
    pollIntervalMs: 1,
    operationTimeoutMs: 1000,
  })

  onTestFinished(() => client.close())

  return createCriaEquipment(client, bindings, createCriaCustody(client, createMemoryAcquisitionArchive(), service.state.storeId))
}

describe('Cria cancellation through Vela workflows', () => {
  it('reports Stop before admission as stopped through the real capture route and controller', async () => {
    const service = new ServiceFixture()
    let release = () => {}

    const gate = new Promise<void>(resolve => { release = resolve })

    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      await gate

      return service.fetch(input, init)
    })

    const adapter = equipment(service, fetch)
    const app = Fastify()

    const catalog = createMemoryRigCatalog([{
      id: 'fixture',
      name: 'Fixture',
      endpoint: { host: 'unused.invalid', port: 11111 },
      imagingCamera: { uniqueId: 'camera', name: 'Fixture camera' },
      addedAt: '2026-10-06T12:00:00.000Z',
      lastObservedInventory: {
        observedAt: '2026-10-06T12:00:00.000Z',
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
        method: 'POST', url: '/api/rigs/fixture/capture/start', payload: { exposureSeconds: 2 },
      })

      expect(start.statusCode).toBe(200)
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
      const stop = await app.inject({ method: 'POST', url: '/api/rigs/fixture/capture/stop', payload: {} })
      expect(stop.statusCode).toBe(200)
      expect(stop.json()).toMatchObject({ phase: 'stopped', active: false, error: null })
      expect(service.posts).toHaveLength(0)
      release()
      await vi.waitFor(() => expect(service.paths).toContain('GET /v2/events'))
      expect(service.posts).toHaveLength(0)
    } finally {
      release()
      await app.close()
    }
  })

  it.each(['cancelled', 'uncertain'] as const)(
    'preserves a %s mount outcome through the alignment controller', async outcome => {
      const service = new ServiceFixture()
      service.completeImmediately = false
      const adapter = equipment(service)

      const controller = createAlignmentController({
        mode: 'offline',
        settings: { cameraId: 'camera', telescopeId: 'mount', exposureSeconds: 1, fieldHeightDegrees: 3 },
        hardware: {
          ...adapter.acquisition,
          pointing: async () => ({
            rightAscensionDegrees: 24, declinationDegrees: 60, siderealTimeDegrees: 45,
            latitudeDegrees: 37, tracking: true, coordinateSystem: 'j2000',
          }),
        },
        solver: { solve: async () => { throw new Error('No image should be taken during this Stop') } },
      })

      await controller.start('fixture', 'Fixture')
      await vi.waitFor(() => expect(service.posts).toHaveLength(1))
      let settled = false

      const stopping = controller.stop().then(view => {
        settled = true

        return view
      })

      await vi.waitFor(() => expect(service.cancellations).toHaveLength(1))
      expect(settled).toBe(false)
      service.finish(outcome)
      const view = await stopping
      expect(view.phase).toBe(outcome === 'cancelled' ? 'stopped' : 'failed')
      expect(view.active).toBe(false)

      if (outcome === 'cancelled') expect(view.error).toBeNull()
      else expect(view.error).toContain('unresolved')
      expect(service.posts).toHaveLength(1)
    },
  )

  it.each(['rotate', 'home', 'tracking'] as const)('translates confirmed %s cancellation at the mount capability', async operation => {
    const service = new ServiceFixture()
    service.completeImmediately = false
    service.cancelImmediately = true
    const adapter = equipment(service)
    const abort = new AbortController()

    const commands = {
      rotate: () => adapter.acquisition.rotateRightAscension('mount', 1, 10, abort.signal),
      home: () => adapter.framing.home('mount', abort.signal),
      tracking: () => adapter.framing.setTracking('mount', true, abort.signal),
    }

    const running = commands[operation]()

    const stopped = expect(running).rejects.toBeInstanceOf(FramingStoppedError)
    await vi.waitFor(() => expect(service.posts).toHaveLength(1))
    abort.abort()
    await stopped
    expect(service.last).toMatchObject({ status: 'cancelled', settled: true, blocksDevice: false })
  })
})
