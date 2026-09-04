import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import type { RigEndpoint } from '@vela/model/rig'
import type { ObservedRigInventory, RigCatalogRecord } from './contracts.js'
import {
  createMemoryRigCatalog,
  InvalidRigInventoryError,
  matchRigCandidate,
  openFileRigCatalog,
  RigCatalogFileError,
} from './catalog.js'

const endpointA: RigEndpoint = { host: '192.168.4.104', port: 11111 }
const endpointB: RigEndpoint = { host: 'ascom-remote.local', port: 11111 }
const validCatalog = `rigs:
  - id: rig-1
    name: Backyard rig
    endpoint:
      host: 192.168.4.104
      port: 11111
    addedAt: 2026-09-02T20:00:00.000Z
    lastObservedInventory:
      observedAt: 2026-09-02T20:01:00.000Z
      devices:
        - uniqueId: camera-1
          kind: camera
          name: Main camera
`

function inventory(
  observedAt: string,
  ...devices: Array<{ uniqueId: string; name?: string }>
): ObservedRigInventory {
  return {
    observedAt,
    devices: devices.map((device) => ({
      uniqueId: device.uniqueId,
      kind: 'camera',
      name: device.name ?? device.uniqueId,
    })),
  }
}

function record(
  id: string,
  endpoint: RigEndpoint,
  observed: ObservedRigInventory,
): RigCatalogRecord {
  return {
    id,
    name: `Rig ${id}`,
    endpoint,
    addedAt: '2026-09-01T20:00:00.000Z',
    lastObservedInventory: observed,
  }
}

async function catalogPath() {
  const directory = await mkdtemp(join(tmpdir(), 'vela-rig-catalog-'))
  return join(directory, 'rigs.yaml')
}

describe('file Rig catalog', () => {
  it('starts empty when the file is missing and survives a restart after the first add', async () => {
    const path = await catalogPath()
    const observed = inventory('2026-09-02T20:00:00.000Z', { uniqueId: 'camera-1' })
    const catalog = await openFileRigCatalog(path, {
      createId: () => 'rig-1',
      now: () => new Date('2026-09-02T20:01:00.000Z'),
    })

    await expect(catalog.list()).resolves.toEqual([])
    await expect(catalog.add({
      name: 'Backyard rig',
      endpoint: endpointA,
      inventory: observed,
    })).resolves.toEqual({
      state: 'added',
      rig: {
        id: 'rig-1',
        name: 'Backyard rig',
        endpoint: endpointA,
        addedAt: '2026-09-02T20:01:00.000Z',
        lastObservedInventory: observed,
      },
    })

    const reopened = await openFileRigCatalog(path)
    await expect(reopened.list()).resolves.toEqual([{
      id: 'rig-1',
      name: 'Backyard rig',
      endpoint: endpointA,
      addedAt: '2026-09-02T20:01:00.000Z',
      lastObservedInventory: observed,
    }])
  })

  it('rejects malformed catalog data instead of replacing it', async () => {
    const path = await catalogPath()
    await writeFile(path, 'rigs:\n  - name: Missing required fields\n')

    await expect(openFileRigCatalog(path)).rejects.toMatchObject({
      name: 'RigCatalogFileError',
      message: 'The Rig catalog is invalid',
      path,
    } satisfies Partial<RigCatalogFileError>)
    expect(await readFile(path, 'utf8')).toBe('rigs:\n  - name: Missing required fields\n')
  })

  it.each([
    ['Rig IDs with surrounding whitespace', 'id: rig-1', 'id: " rig-1"'],
    ['hosts with surrounding whitespace', 'host: 192.168.4.104', 'host: "192.168.4.104 "'],
    ['device IDs with surrounding whitespace', 'uniqueId: camera-1', 'uniqueId: " camera-1"'],
    [
      'noncanonical added timestamps',
      'addedAt: 2026-09-02T20:00:00.000Z',
      'addedAt: 2026-09-02T20:00:00Z',
    ],
    [
      'noncanonical observation timestamps',
      'observedAt: 2026-09-02T20:01:00.000Z',
      'observedAt: 2026-09-02T20:01:00Z',
    ],
  ])('rejects %s', async (_description, valid, invalid) => {
    const path = await catalogPath()
    await writeFile(path, validCatalog.replace(valid, invalid))

    await expect(openFileRigCatalog(path)).rejects.toBeInstanceOf(RigCatalogFileError)
  })

  it('rejects invalid observed inventory without corrupting the file', async () => {
    const path = await catalogPath()
    const originalInventory = inventory(
      '2026-09-02T20:00:00.000Z',
      { uniqueId: 'camera-1' },
    )
    const catalog = await openFileRigCatalog(path, { createId: () => 'rig-1' })
    await catalog.add({
      name: 'Backyard rig',
      endpoint: endpointA,
      inventory: originalInventory,
    })

    await expect(catalog.observe(endpointA, {
      observedAt: '2026-09-02T21:00:00.000Z',
      devices: [
        { uniqueId: 'camera-1', kind: 'camera', name: 'Main camera' },
        { uniqueId: 'camera-1', kind: 'camera', name: 'Duplicate camera' },
      ],
    })).rejects.toBeInstanceOf(InvalidRigInventoryError)
    await expect((await openFileRigCatalog(path)).list()).resolves.toMatchObject([{
      lastObservedInventory: originalInventory,
    }])
  })

  it('preserves saved state after a failed write and accepts the next change', async () => {
    const path = await catalogPath()
    const backup = `${path}.backup`
    let nextId = 0
    const catalog = await openFileRigCatalog(path, { createId: () => `rig-${++nextId}` })

    try {
      await catalog.add({
        name: 'Original rig',
        endpoint: endpointA,
        inventory: inventory('2026-09-02T20:00:00.000Z', { uniqueId: 'camera-1' }),
      })
      const original = await catalog.list()

      await rename(path, backup)
      await mkdir(path)
      await expect(catalog.forget('rig-1')).rejects.toBeInstanceOf(RigCatalogFileError)
      await expect(catalog.list()).resolves.toEqual(original)

      await rm(path, { recursive: true })
      await rename(backup, path)
      await expect((await openFileRigCatalog(path)).list()).resolves.toEqual(original)

      await expect(catalog.add({
        name: 'Second rig',
        endpoint: endpointB,
        inventory: inventory('2026-09-02T20:01:00.000Z', { uniqueId: 'camera-2' }),
      })).resolves.toMatchObject({ state: 'added', rig: { id: 'rig-2' } })
      const saved = await catalog.list()
      expect(saved.map(({ id }) => id)).toEqual(['rig-1', 'rig-2'])
      await expect((await openFileRigCatalog(path)).list()).resolves.toEqual(saved)
    } finally {
      await rm(dirname(path), { recursive: true, force: true })
    }
  })

  it('serializes concurrent additions without losing either Rig', async () => {
    const path = await catalogPath()
    let nextId = 0
    const catalog = await openFileRigCatalog(path, {
      createId: () => `rig-${++nextId}`,
    })

    await Promise.all([
      catalog.add({
        name: 'First rig',
        endpoint: endpointA,
        inventory: inventory('2026-09-02T20:00:00.000Z', { uniqueId: 'camera-1' }),
      }),
      catalog.add({
        name: 'Second rig',
        endpoint: endpointB,
        inventory: inventory('2026-09-02T20:00:00.000Z', { uniqueId: 'camera-2' }),
      }),
    ])

    await expect(catalog.list()).resolves.toHaveLength(2)
    await expect((await openFileRigCatalog(path)).list()).resolves.toHaveLength(2)
  })
})

describe('Rig catalog reconciliation', () => {
  it('matches by endpoint or device ID and treats contradictory evidence as a conflict', () => {
    const records = [
      record('rig-a', endpointA, inventory('2026-09-01T20:00:00.000Z', { uniqueId: 'camera-a' })),
      record('rig-b', endpointB, inventory('2026-09-01T20:00:00.000Z', { uniqueId: 'camera-b' })),
    ]

    expect(matchRigCandidate(
      records,
      endpointA,
      inventory('2026-09-02T20:00:00.000Z', { uniqueId: 'camera-a' }),
    )).toEqual({
      state: 'known',
      rigId: 'rig-a',
      endpointChanged: false,
      inventoryChanged: false,
    })

    expect(matchRigCandidate(
      records,
      { host: '192.168.4.120', port: 11111 },
      inventory('2026-09-02T20:00:00.000Z', { uniqueId: 'camera-a' }),
    )).toEqual({
      state: 'known',
      rigId: 'rig-a',
      endpointChanged: true,
      inventoryChanged: false,
    })

    expect(matchRigCandidate(
      records,
      endpointA,
      inventory('2026-09-02T20:00:00.000Z', { uniqueId: 'camera-b' }),
    )).toEqual({ state: 'conflict', rigIds: ['rig-a', 'rig-b'] })
  })

  it('updates a known Rig snapshot and endpoint, prevents duplicate addition, and forgets it', async () => {
    const original = record(
      'rig-a',
      endpointA,
      inventory('2026-09-01T20:00:00.000Z', { uniqueId: 'camera-a', name: 'Old name' }),
    )
    const catalog = createMemoryRigCatalog([original])
    const nextEndpoint = { host: '192.168.4.120', port: 32323 }
    const nextInventory = inventory(
      '2026-09-02T20:00:00.000Z',
      { uniqueId: 'camera-a', name: 'Main camera' },
      { uniqueId: 'focuser-a', name: 'Focuser' },
    )

    await expect(catalog.observe(nextEndpoint, nextInventory)).resolves.toEqual({
      state: 'known',
      rigId: 'rig-a',
      endpointChanged: true,
      inventoryChanged: true,
    })
    await expect(catalog.list()).resolves.toEqual([{
      ...original,
      endpoint: nextEndpoint,
      lastObservedInventory: nextInventory,
    }])
    await expect(catalog.add({
      name: 'Duplicate',
      endpoint: nextEndpoint,
      inventory: nextInventory,
    })).resolves.toEqual({ state: 'known', rigId: 'rig-a' })
    await expect(catalog.get('rig-a')).resolves.toEqual({
      ...original,
      endpoint: nextEndpoint,
      lastObservedInventory: nextInventory,
    })

    await expect(catalog.forget('rig-a')).resolves.toBe(true)
    await expect(catalog.forget('rig-a')).resolves.toBe(false)
    await expect(catalog.get('rig-a')).resolves.toBeUndefined()
    await expect(catalog.list()).resolves.toEqual([])
  })

  it('does not update either Rig when device IDs match more than one', async () => {
    const records = [
      record('rig-a', endpointA, inventory('2026-09-01T20:00:00.000Z', { uniqueId: 'camera-a' })),
      record('rig-b', endpointB, inventory('2026-09-01T20:00:00.000Z', { uniqueId: 'camera-b' })),
    ]
    const catalog = createMemoryRigCatalog(records)

    await expect(catalog.observe(
      { host: '192.168.4.120', port: 11111 },
      inventory(
        '2026-09-02T20:00:00.000Z',
        { uniqueId: 'camera-a' },
        { uniqueId: 'camera-b' },
      ),
    )).resolves.toEqual({ state: 'conflict', rigIds: ['rig-a', 'rig-b'] })
    await expect(catalog.list()).resolves.toEqual(records)
  })
})
