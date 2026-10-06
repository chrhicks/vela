import { describe, expect, it } from 'vitest'
import { criaDeviceId, parseCriaConfiguration, registerConfiguredCriaRigs } from './config.js'
import { createMemoryRigCatalog, matchRigCandidate } from '../rig/catalog.js'
import type { RigCatalogRecord } from '../rig/contracts.js'

const configuration = {
  id: 'fra-cria',
  name: 'FRA 400',
  url: 'http://cria.local:4319',
  tokenEnv: 'CRIA_TEST_TOKEN',
  storeId: '11111111-1111-4111-8111-111111111111',
  devices: [
    { id: 'camera', kind: 'camera', expectedName: 'Main camera' },
    { id: 'mount', kind: 'mount', expectedName: 'Mount' },
  ],
  imagingCameraId: 'camera',
  focalLengthMm: 400,
  alignment: { mode: 'physical', cameraId: 'camera', telescopeId: 'mount' },
}

const environment = { CRIA_TEST_TOKEN: 'private-token-for-local-tests-only' }

const legacy: RigCatalogRecord = {
  id: 'legacy',
  name: 'Legacy rig',
  endpoint: { host: 'cria.local', port: 4319 },
  addedAt: '2026-10-06T12:00:00.000Z',
  lastObservedInventory: {
    observedAt: '2026-10-06T12:00:00.000Z',
    devices: [{ uniqueId: 'camera', kind: 'camera', name: 'Old camera' }],
  },
}

describe('explicit Cria rig configuration', () => {
  it('registers ownership and selections without inventing an observed device inventory or persisting the token', async () => {
    const [configured] = parseCriaConfiguration(JSON.stringify({ rigs: [configuration] }), environment)
    const catalog = createMemoryRigCatalog([legacy])
    await registerConfiguredCriaRigs(catalog, [configured!])
    const rig = await catalog.get(configuration.id)

    expect(rig).toMatchObject({
      id: configuration.id,
      source: { kind: 'cria', configurationId: configuration.id },
      imagingCamera: { uniqueId: criaDeviceId(configured!, 'camera'), name: 'Main camera' },
      focalLengthMm: 400,
      lastObservedInventory: { devices: [] },
    })
    expect(JSON.stringify(await catalog.list())).not.toContain(environment.CRIA_TEST_TOKEN)
    expect(JSON.stringify(await catalog.list())).not.toContain('tokenEnv')

    await catalog.setFocalLength(configuration.id, 320)
    await registerConfiguredCriaRigs(catalog, [configured!])
    expect((await catalog.get(configuration.id))?.focalLengthMm).toBe(320)
  })

  it('keeps endpoint and overlapping local IDs from migrating a Cria rig through Alpaca discovery', async () => {
    const [configured] = parseCriaConfiguration(JSON.stringify({ rigs: [configuration] }), environment)
    const catalog = createMemoryRigCatalog([legacy])
    await registerConfiguredCriaRigs(catalog, [configured!])
    const rigs = await catalog.list()
    const inventory = legacy.lastObservedInventory

    expect(matchRigCandidate(rigs, legacy.endpoint, inventory)).toMatchObject({ state: 'known', rigId: 'legacy' })
    expect(matchRigCandidate(rigs, legacy.endpoint, inventory, {
      kind: 'cria', configurationId: configuration.id,
    })).toMatchObject({ state: 'known', rigId: configuration.id })

    await catalog.observe({ host: 'new-alpaca.local', port: 11111 }, inventory)
    expect((await catalog.get(configuration.id))?.endpoint).toEqual(legacy.endpoint)
    expect((await catalog.get('legacy'))?.endpoint.host).toBe('new-alpaca.local')
  })

  it('rejects ambiguous ownership, credential URLs, and an unconfigured imaging camera', () => {
    const invalid = [
      { rigs: [configuration, { ...configuration, id: 'another-rig' }] },
      { rigs: [{ ...configuration, url: 'http://user:secret@cria.local:4319' }] },
      { rigs: [{ ...configuration, imagingCameraId: 'mount' }] },
    ]

    for (const input of invalid)
      expect(() => parseCriaConfiguration(JSON.stringify(input), environment)).toThrow('Invalid Cria configuration')

    expect(() => parseCriaConfiguration(JSON.stringify({ rigs: [configuration] }), {})).toThrow('CRIA_TEST_TOKEN')
  })

  it('refuses to replace a legacy rig with a matching configured rig ID', async () => {
    const configured = parseCriaConfiguration(JSON.stringify({
      rigs: [{ ...configuration, id: legacy.id }],
    }), environment)

    const catalog = createMemoryRigCatalog([legacy])

    await expect(registerConfiguredCriaRigs(catalog, configured)).rejects.toThrow('another equipment source')
    expect(await catalog.get(legacy.id)).toEqual(legacy)
  })
})
