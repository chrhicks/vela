import Fastify from 'fastify'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { epochMs, type RigEvent } from '@vela/rig-events'
import { registerAlerts } from '../alerts/routes.js'
import { defaultThresholds } from '../alerts/thresholds.js'
import { createMemoryRigCatalog } from '../rig/catalog.js'
import type { RigCatalogRecord } from '../rig/contracts.js'
import { createAttestation } from './attestation.js'
import { registerAttestation } from './routes.js'

const rig: RigCatalogRecord = {
  id: 'sim',
  name: 'Simulator',
  endpoint: { host: '127.0.0.1', port: 11111 },
  imagingCamera: { uniqueId: 'camera', name: 'Main camera' },
  focalLengthMm: 400,
  source: { kind: 'cria', configurationId: 'sim' },
  addedAt: '2026-09-01T20:00:00.000Z',
  lastObservedInventory: { observedAt: '2026-09-01T20:00:00.000Z', devices: [] },
}

type CriaHealth = Readonly<Record<string, string | number>>

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function install() {
  const root = await mkdtemp(join(tmpdir(), 'vela-attestation-'))

  directories.push(root)

  const executable = join(root, 'astap', 'astap_cli')
  const catalogPath = join(root, 'astap', 'catalog')

  await mkdir(catalogPath, { recursive: true })
  await writeFile(executable, 'astap build 1')
  await writeFile(join(catalogPath, 'd05_0101.1476'), 'catalog tile one')
  await writeFile(join(catalogPath, 'd05_0102.1476'), 'catalog tile two')

  const events: RigEvent[] = []
  let rigs = [rig]
  let health: CriaHealth | Error = { status: 'ok', protocolVersion: 5, build: 'cria-build-1' }

  const attestation = createAttestation({
    manifestPath: join(root, 'attestation.json'),
    solver: { executable, catalogPath },
    rigs: async () => rigs,
    criaOrigin: () => 'http://cria.test',
    runLog: { append: event => events.push(event) },
    fetch: async () => {
      if (health instanceof Error) throw health

      return Response.json(health)
    },
    now: () => 1_792_000_000_000,
  })

  return {
    root,
    attestation,
    events,
    catalogFile: join(catalogPath, 'd05_0102.1476'),
    executable,
    setRigs: (next: RigCatalogRecord[]) => (rigs = next),
    setHealth: (next: CriaHealth | Error) => (health = next),
    statuses: () => {
      const event = events.at(-1)

      if (event?.kind !== 'attestation') throw new Error('No attestation event was filed')

      return Object.fromEntries(event.body.items.map(({ item, status }) => [item, status]))
    },
  }
}

describe('attestation', () => {
  it('pins an unpinned install without a warning and files the items as unpinned', async () => {
    const { attestation, events, statuses } = await install()

    await attestation.check()

    expect(attestation.warningsFor('sim')).toEqual([])
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'attestation', rig: 'sim', at: epochMs(1_792_000_000_000) })
    expect(statuses()).toEqual({ astap: 'unpinned', catalog: 'unpinned', 'cria/sim': 'unpinned', 'optics/sim': 'unpinned' })
  })

  it('matches on a second check of the same install', async () => {
    const { attestation, statuses } = await install()

    await attestation.check()
    await attestation.check()

    expect(attestation.warningsFor('sim')).toEqual([])
    expect(statuses()).toEqual({ astap: 'match', catalog: 'match', 'cria/sim': 'match', 'optics/sim': 'match' })
  })

  it('warns, in the rig view and in the run log, when a catalog file changed, and nothing stops', async () => {
    const { attestation, statuses, catalogFile } = await install()
    const app = Fastify()
    const catalog = createMemoryRigCatalog([rig])

    registerAlerts(app, catalog, { thresholds: defaultThresholds, notifier: null, attestationWarnings: attestation.warningsFor })
    registerAttestation(app, attestation)

    await attestation.check()
    await writeFile(catalogFile, 'catalog tile two, edited')
    await attestation.check()

    const view = await app.inject({ method: 'GET', url: '/api/web/rigs/sim/alerts' })

    expect(statuses()).toMatchObject({ astap: 'match', catalog: 'changed' })
    expect(view.statusCode).toBe(200)
    expect(view.json().attestation).toEqual([expect.stringMatching(/^Star catalog differs from what was pinned on 2026-10-1/)])

    const repin = await app.inject({ method: 'POST', url: '/api/attestation/pin', headers: { 'content-type': 'application/json' }, payload: {} })
    const after = await app.inject({ method: 'GET', url: '/api/web/rigs/sim/alerts' })

    expect(repin.statusCode).toBe(200)
    expect(statuses()).toMatchObject({ catalog: 'match' })
    expect(after.json().attestation).toEqual([])
    await app.close()
  })

  it('warns when a pinned item is missing', async () => {
    const { attestation, statuses, executable } = await install()

    await attestation.check()
    await rm(executable)
    await attestation.check()

    expect(statuses()).toMatchObject({ astap: 'missing' })
    expect(attestation.warningsFor('sim')).toEqual([expect.stringMatching(/^ASTAP binary was pinned on .* and could not be read now\.$/)])
  })

  it('warns when Cria reports a different build, and when it does not answer', async () => {
    const { attestation, statuses, setHealth } = await install()

    await attestation.check()
    setHealth({ status: 'ok', protocolVersion: 5, build: 'cria-build-2' })
    await attestation.check()

    expect(statuses()).toMatchObject({ 'cria/sim': 'changed' })

    setHealth(new TypeError('fetch failed'))
    await attestation.check()

    expect(statuses()).toMatchObject({ 'cria/sim': 'missing' })
    expect(attestation.warningsFor('sim')).toHaveLength(1)
  })

  it('warns when the optics changed', async () => {
    const { attestation, statuses, setRigs } = await install()

    await attestation.check()
    setRigs([{ ...rig, focalLengthMm: 560 }])
    await attestation.check()

    expect(statuses()).toMatchObject({ 'optics/sim': 'changed' })
    expect(attestation.warningsFor('sim')).toEqual([expect.stringMatching(/^Optics differs/)])
  })

  it('leaves a rig added after the pin unpinned, without a warning', async () => {
    const { attestation, statuses, setRigs } = await install()

    await attestation.check()
    setRigs([rig, { ...rig, id: 'second', source: { kind: 'cria', configurationId: 'second' } }])
    await attestation.check()

    expect(attestation.warningsFor('second')).toEqual([])
    expect(statuses()).toMatchObject({ astap: 'match', 'optics/second': 'unpinned' })
  })

  it('warns, and pins nothing, when the manifest file cannot be read', async () => {
    const { attestation, root, events } = await install()

    await writeFile(join(root, 'attestation.json'), '{not json')
    await attestation.check()

    expect(attestation.warningsFor('sim')).toEqual(['The pinned manifest could not be read. Pin again to replace it.'])
    expect(events).toEqual([])
  })
})
