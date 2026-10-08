import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { EquipmentError } from '@vela/equipment'
import { createMemoryRigCatalog } from '../src/rig/catalog.js'
import { createEquipmentComposition } from '../src/equipment/composition.js'
import { createMemoryAcquisitionArchive } from '../src/acquisitions/archive.js'
import { registerArchiveHealth } from '../src/acquisitions/health-routes.js'
import { createArchiveHealth, createArchiveHealthTracker } from '../src/cria/archive-health.js'
import { ServiceFixture } from '../../../packages/cria/test/fixture.js'
import type { CriaRigConfiguration } from '../src/equipment/config.js'

async function app(healthFor: Parameters<typeof registerArchiveHealth>[2]) {
  const catalog = createMemoryRigCatalog()
  const added = await catalog.add({ name: 'FRA 400', endpoint: { host: '127.0.0.1', port: 1 }, inventory: { devices: [], observedAt: '2026-10-08T22:00:00.000Z' } })

  if (added.state !== 'added') throw new Error('Fixture rig was not added')
  const server = Fastify()

  registerArchiveHealth(server, catalog, healthFor)

  return { server, rig: added.rig }
}

describe('archive health routes', () => {
  it('says an ALPACA rig has no originals in Vela custody', async () => {
    const { server, rig } = await app(() => undefined)
    const response = await server.inject(`/api/web/rigs/${rig.id}/archive`)

    expect(response.json()).toEqual({ rigId: rig.id, rigName: 'FRA 400', preservation: 'none' })
    expect((await server.inject('/api/web/rigs/unknown/archive')).statusCode).toBe(404)
  })

  it('names the rig around its store health and reconciles through the same projection', async () => {
    const service = new ServiceFixture()
    const client = service.client()
    const tracker = createArchiveHealthTracker()
    let reconciled = 0

    const health = createArchiveHealth({
      client,
      archive: createMemoryAcquisitionArchive(),
      tracker,
      storeId: service.state.storeId,
      reconcile: async () => { reconciled++ },
      owns: () => false,
    })

    const { server, rig } = await app(() => health)
    const view = (await server.inject(`/api/web/rigs/${rig.id}/archive`)).json()

    expect(view).toMatchObject({ rigId: rig.id, rigName: 'FRA 400', preservation: 'cria', status: 'current' })
    expect((await server.inject({ method: 'POST', url: `/api/rigs/${rig.id}/archive/reconcile` })).statusCode).toBe(200)
    expect(reconciled).toBe(1)
    expect(service.posts).toEqual([])
    await client.close()
  })

  it('refuses health reads and reconciliation once the composition is closing', async () => {
    const configuration: CriaRigConfiguration = {
      id: 'cria-rig',
      name: 'Cria rig',
      url: 'http://127.0.0.1:1',
      tokenEnv: 'UNIT_TEST_TOKEN',
      token: 'fixture-private-token-with-32-characters',
      storeId: crypto.randomUUID(),
      devices: [{ id: 'camera', kind: 'camera', expectedName: 'FIXTURE camera' }],
    }

    const composition = createEquipmentComposition([configuration], { acquisitions: createMemoryAcquisitionArchive() })
    const source = { id: 'cria-rig', endpoint: { host: '127.0.0.1', port: 1 }, source: { kind: 'cria' as const, configurationId: 'cria-rig' } }

    expect(composition.archiveHealth(source)).toBeDefined()
    await composition.close()
    expect(() => composition.archiveHealth(source)).toThrow(EquipmentError)

    const { server, rig } = await app(() => composition.archiveHealth(source))

    expect((await server.inject({ method: 'POST', url: `/api/rigs/${rig.id}/archive/reconcile` })).statusCode).toBe(503)
  })
})
