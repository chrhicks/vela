import { createServer } from 'node:http'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { expect, it, vi } from 'vitest'
import { z } from 'zod'
import { FakeCria } from '../../../packages/cria/test/v5/fake-cria.js'

const token = 'test-only-token-for-the-in-memory-fixture'

import { decodeLine } from '@vela/rig-events'
import { buildApp } from '../src/app.js'
import { openRunLog } from '../src/run-log/run-log.js'
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

it('writes what every connection decodes to the run log as envelopes for its rig', async () => {
  vi.useFakeTimers({ now: Date.UTC(2026, 9, 17, 3) })
  const directory = await mkdtemp(join(tmpdir(), 'vela-composition-run-log-'))
  const service = new FakeCria()
  const runLog = openRunLog({ directory })

  const composition = createEquipmentComposition(
    [{ id: 'fixture', name: 'Fixture', url: service.origin, devices: [{ id: 'camera', kind: 'camera', expectedName: 'Fake CCD' }] }],
    { fetch: service.fetch, runLog },
  )

  composition.start()
  await vi.advanceTimersByTimeAsync(2_500)
  await composition.close()
  service.close()
  vi.useRealTimers()
  await runLog.close()

  const [name] = await readdir(directory)
  const lines = (await readFile(join(directory, name!), 'utf8')).trimEnd().split('\n').map(line => decodeLine(line))

  await rm(directory, { recursive: true, force: true })
  expect(lines.every(line => line.ok)).toBe(true)

  const events = lines.flatMap(line => (line.ok ? [line.event] : []))

  expect(events.every(event => event.rig === 'fixture' && event.source === 'vela:cria')).toBe(true)
  expect(events.slice(0, 2).map(event => event.kind)).toEqual(['cria.stream', 'cria.state'])
  expect(events.filter(event => event.kind === 'cria.state').length).toBeGreaterThan(1)
  expect(runLog.health().state).toBe('closed')
})

it('refuses a Cria rig id the run log cannot name', () => {
  expect(() =>
    createEquipmentComposition([{ id: 'Fixture', name: 'Fixture', url: 'http://cria.test', devices: [{ id: 'camera', kind: 'camera', expectedName: 'Fake CCD' }] }], {
      runLog: { append() {} },
    }),
  ).toThrow('Cria rig id "Fixture"')
})

it('reports the run log on /api/health', async () => {
  const runLog = openRunLog({ directory: join(tmpdir(), 'vela-health-never-written') })
  const off = buildApp()
  const on = buildApp({ runLog })

  const [without, withLog] = await Promise.all([off.inject('/api/health'), on.inject('/api/health')])

  await Promise.all([off.close(), on.close(), runLog.close()])
  expect(without.json()).toEqual({ status: 'ok', runLog: { state: 'off' } })
  expect(withLog.json()).toMatchObject({ status: 'ok', runLog: { state: 'ok', file: null, dropped: 0, lastError: null } })
})
