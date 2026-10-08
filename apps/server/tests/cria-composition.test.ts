import { createServer } from 'node:http'
import { once } from 'node:events'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { ServiceFixture, token } from '../../../packages/cria/test/fixture.js'
import { buildApp } from '../src/app.js'
import { createMemoryRigCatalog } from '../src/rig/catalog.js'
import { createEquipmentComposition } from '../src/equipment/composition.js'
import { createMemoryAcquisitionArchive } from '../src/acquisitions/archive.js'
import { registerConfiguredCriaRigs, type CriaRigConfiguration } from '../src/equipment/config.js'

it('shares one authenticated stream across configured rigs and closes it with the app', async () => {
  const service = new ServiceFixture()
  const requests: string[] = []
  let openStreams = 0
  let streamClosed = () => {}

  const closed = new Promise<void>(resolve => { streamClosed = resolve })

  const remote = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`)

    if (request.headers.authorization !== `Bearer ${token}` || request.url !== '/v2/events') {
      response.writeHead(400).end()

      return
    }

    openStreams++
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write(`event: state\ndata: ${JSON.stringify(service.state)}\n\n`)
    response.on('close', () => {
      openStreams--
      streamClosed()
    })
  })

  remote.listen(0, '127.0.0.1')
  await once(remote, 'listening')
  const address = z.object({ port: z.number().int().positive() }).parse(remote.address())

  const configurations: CriaRigConfiguration[] = service.state.devices.map(device => ({
    id: device.id,
    name: device.expectedName,
    url: `http://127.0.0.1:${address.port}`,
    tokenEnv: 'UNIT_TEST_TOKEN',
    token,
    storeId: service.state.storeId,
    devices: [{ id: device.id, kind: device.kind, expectedName: device.expectedName }],
  }))

  const catalog = createMemoryRigCatalog()
  await registerConfiguredCriaRigs(catalog, configurations)

  const app = buildApp({
    equipment: createEquipmentComposition(configurations, { acquisitions: createMemoryAcquisitionArchive() }),
    rigCatalog: catalog,
  })

  try {
    expect(requests).toEqual([])

    const views = await Promise.all(configurations.map(configuration =>
      app.inject(`/api/web/rigs/${configuration.id}`),
    ))

    for (const view of views) {
      expect(view.statusCode).toBe(200)
      expect(view.json().connections.connected).toBe(1)
    }

    await app.inject('/api/web/rigs/camera')
    expect(requests).toEqual(['GET /v2/events'])
    expect(openStreams).toBe(1)
    await app.close()
    await closed
    expect(openStreams).toBe(0)
  } finally {
    await app.close()
    remote.closeAllConnections()
    await new Promise<void>(resolve => remote.close(() => resolve()))
  }
})
