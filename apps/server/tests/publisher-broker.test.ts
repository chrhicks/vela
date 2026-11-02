import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { connect } from '@nats-io/transport-node'
import { jetstreamManager } from '@nats-io/jetstream'
import { decodeLine, epochMs, rigId, seal, sourceId, type RigEvent } from '@vela/rig-events'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { FakeCria } from '../../../packages/cria/test/v5/fake-cria.js'
import { buildApp } from '../src/app.js'
import { createEquipmentComposition } from '../src/equipment/composition.js'
import { registerConfiguredCriaRigs, type CriaRigConfiguration } from '../src/equipment/config.js'
import { createMemoryRigCatalog } from '../src/rig/catalog.js'
import { frameRecordsOn } from '../src/capture/frame-records.js'
import { openRunLog } from '../src/run-log/run-log.js'
import { openPublisher } from '../src/run-log/publisher.js'

it.skipIf(!process.env.TEST_NATS_URL)('captures through broker loss, then reads the exact gap and retained tail from JetStream', async () => {
  const url = process.env.TEST_NATS_URL!
  const credentialsFile = process.env.TEST_NATS_CREDENTIALS!
  const container = process.env.TEST_NATS_CONTAINER!
  const directory = await mkdtemp(join(tmpdir(), 'publisher-capture-'))
  const publisher = openPublisher({ url, credentialsFile, limits: { count: 128, bytes: 5 * 1024 ** 2, messageBytes: 1024 ** 2 } })
  const received: RigEvent[] = []
  const log = openRunLog({ directory, onAppend(event) { received.push(event); publisher.append(event) } })
  const cria = new FakeCria()

  const config: CriaRigConfiguration = { id: 'fixture', name: 'Fixture', url: cria.origin,
    devices: [{ id: 'camera', kind: 'camera', expectedName: 'Fake CCD' }], imagingCameraId: 'camera' }

  const rigCatalog = createMemoryRigCatalog()

  await registerConfiguredCriaRigs(rigCatalog, [config])
  const equipment = createEquipmentComposition([config], { fetch: cria.fetch, runLog: log })
  const app = buildApp({ equipment, rigCatalog, runLog: log, publisher, frameRecords: frameRecordsOn(log) })

  async function frames(killBroker = false) {
    await expect.poll(async () => (await app.inject('/api/web/rigs/fixture/capture')).json().enabled, { timeout: 5000 }).toBe(true)
    const before = Date.now()
    const result = await app.inject({ method: 'POST', url: '/api/rigs/fixture/capture/start', payload: { exposureSeconds: 1, repeat: true, frameCount: 3 } })

    expect(result.statusCode, result.body).toBe(200)

    if (killBroker) execFileSync('docker', ['kill', container], { stdio: 'ignore' })
    await expect.poll(async () => (await app.inject('/api/web/rigs/fixture/capture')).json().completedCount, { timeout: 8000 }).toBe(3)
    const elapsed = Date.now() - before
    await expect.poll(async () => (await app.inject('/api/web/rigs/fixture/capture')).json().active).toBe(false)

    return elapsed
  }

  try {
    await app.ready()
    await app.inject('/api/web/rigs/fixture')
    await expect.poll(() => publisher.health().connected).toBe(true)
    const liveMs = await frames()

    const downMs = await frames(true)

    await expect.poll(() => publisher.health().connected).toBe(false)

    expect(downMs).toBeLessThan(liveMs + 1000)
    await app.close()
    await delay(600)
    const droppedBefore = publisher.health().dropped
    const queuedBefore = publisher.health().queued

    const burst = Array.from({ length: 140 }, (_, n) => seal({ kind: 'cria.exchange', rig: rigId('fixture'), source: sourceId('test:publisher'),
      at: epochMs(1000 + n), seenAt: epochMs(1000 + n), body: { origin: 'http://fake.test', method: 'GET', route: `/probe/${n}`, ms: 1, status: 200, command: null, reply: { kind: 'answered', body: {} } } }))

    for (const event of burst) log.append(event)
    const expectedDrops = droppedBefore + queuedBefore + 12

    expect(publisher.health()).toMatchObject({ queued: 128, dropped: expectedDrops })
    expect(publisher.health().queuedBytes).toBeLessThanOrEqual(5 * 1024 ** 2)
    execFileSync('docker', ['start', container], { stdio: 'ignore' })
    await expect.poll(() => publisher.health().queued, { timeout: 10000 }).toBe(0)
    const credentials = z.object({ provisioner: z.string() }).parse(JSON.parse(await readFile(credentialsFile, 'utf8')))
    const admin = await connect({ servers: url, user: 'provisioner', pass: credentials.provisioner, inboxPrefix: '_INBOX.provisioner' })

    try {
      const js = await jetstreamManager(admin)
      const info = await js.streams.info('RIG_FACTS')
      const events: RigEvent[] = []

      for (let seq = 1; seq <= info.state.last_seq; seq++) {
        const message = await js.streams.getMessage('RIG_FACTS', { seq })
        const decoded = decodeLine(message.string())

        expect(decoded.ok).toBe(true)

        if (decoded.ok) {
          events.push(decoded.event)
          expect(message.header.get('Nats-Msg-Id')).toBe(decoded.event.id)
        }
      }

      const gaps = events.filter(event => event.kind === 'gap' && event.source.startsWith('vela:nats:'))

      expect(gaps).toHaveLength(1)
      expect(gaps.reduce((count, event) => count + (event.kind === 'gap' ? event.body.dropped ?? 0 : 0), 0)).toBe(expectedDrops)
      expect(events.flatMap(event => event.kind === 'cria.exchange' && event.source === 'test:publisher' ? [event.id] : [])).toEqual(burst.slice(-128).map(event => event.id))
      expect(gaps.some(event => event.kind === 'gap' && event.body.from <= 1000 && event.body.to !== null && event.body.to >= 1011)).toBe(true)
      expect(received.length).toBeGreaterThan(140)
      console.log(JSON.stringify({ liveMs, downMs, expectedDrops, gaps: gaps.length, retainedTail: 128, captureResponses: 'all 200' }))
    } finally { await admin.close() }
  } finally {
    await app.close()
    cria.close()
    await publisher.close()
    await log.close()
    await rm(directory, { recursive: true, force: true })
  }
}, 30000)
