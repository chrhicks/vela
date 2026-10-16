import { createServer } from 'node:http'
import { once } from 'node:events'
import { expect, it, vi } from 'vitest'
import { z } from 'zod'
import { FakeCria } from '../../../packages/cria/test/v5/fake-cria.js'

const token = 'test-only-token-for-the-in-memory-fixture'

import { buildApp } from '../src/app.js'
import { createMemoryRigCatalog } from '../src/rig/catalog.js'
import { createEquipmentComposition } from '../src/equipment/composition.js'
import { registerConfiguredCriaRigs, type CriaRigConfiguration } from '../src/equipment/config.js'

it('shares one authenticated stream across configured rigs and closes it with the app', async () => {
  const service = new FakeCria(token)
  const state = await (await service.fetch(`${service.origin}/v2/state`, { headers: { authorization: `Bearer ${token}` } })).json()
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
    response.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`)
    response.on('close', () => {
      openStreams--
      streamClosed()
    })
  })

  remote.listen(0, '127.0.0.1')
  await once(remote, 'listening')
  const address = z.object({ port: z.number().int().positive() }).parse(remote.address())

  const configurations: CriaRigConfiguration[] = state.devices.map((device: { id: string; kind: 'camera' | 'mount' | 'focuser'; name: string }) => ({
    id: device.id,
    name: device.name,
    url: `http://127.0.0.1:${address.port}`,
    tokenEnv: 'UNIT_TEST_TOKEN',
    token,
    devices: [{ id: device.id, kind: device.kind, expectedName: device.name }],
  }))

  const catalog = createMemoryRigCatalog()
  await registerConfiguredCriaRigs(catalog, configurations)

  const app = buildApp({
    equipment: createEquipmentComposition(configurations),
    rigCatalog: catalog,
  })

  try {
    expect(requests).toEqual([])

    await app.ready()
    await vi.waitFor(async () => {
      for (const configuration of configurations) {
        const view = await app.inject(`/api/web/rigs/${configuration.id}`)
        expect(view.statusCode).toBe(200)
        expect(view.json().connections.connected).toBe(1)
      }
    })

    await app.inject('/api/web/rigs/camera')
    expect(requests).toEqual(['GET /v2/events'])
    expect(openStreams).toBe(1)
    await app.close()
    await closed
    expect(openStreams).toBe(0)
  } finally {
    await app.close()
    service.close()
    remote.closeAllConnections()
    await new Promise<void>(resolve => remote.close(() => resolve()))
  }
})
