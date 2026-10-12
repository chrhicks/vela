import { describe, expect, it, onTestFinished } from 'vitest'
import { CriaClient } from '@vela/cria'
import { FrameLostError } from '@vela/equipment'
import { ServiceFixture, serviceOrigin, token } from '../../../packages/cria/test/fixture.js'
import { createCriaEquipment } from '../src/cria/equipment.js'

describe('Cria frame lost before it is fetched', () => {
  it('reports a lost frame without another exposure', async () => {
    const service = new ServiceFixture()

    const bindings = service.state.devices.map(device => ({
      id: device.id,
      kind: device.kind,
      expectedName: device.expectedName,
      providerDeviceId: device.id,
    }))

    // Cria has dropped the image by the time Vela fetches it.
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
    const adapter = createCriaEquipment(client, bindings)

    await expect(adapter.acquisition.capture({
      cameraId: 'camera',
      expectedCameraName: service.camera.expectedName,
      exposureSeconds: 1,
    })).rejects.toBeInstanceOf(FrameLostError)

    expect(service.posts).toHaveLength(1)
  })
})
