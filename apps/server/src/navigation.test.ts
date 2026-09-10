import { expect, it, vi } from 'vitest'
import { buildApp } from './app.js'
import { createMemoryRigCatalog } from './rig/catalog.js'
import { createMemorySavedImageStore } from './saved-images/store.js'

it('serves catalog identities at composition without hardware or storage queries, including an empty catalog', async () => {
  const catalog = createMemoryRigCatalog()
  const savedImages = createMemorySavedImageStore()
  const count = vi.spyOn(savedImages, 'count')
  const list = vi.spyOn(savedImages, 'list')
  const createInspector = vi.fn(() => { throw new Error('Unexpected device inspection') })
  const createInventory = vi.fn(() => { throw new Error('Unexpected inventory query') })
  const app = buildApp({ rigCatalog: catalog, savedImages, createInspector, createInventory })

  try {
    expect((await app.inject('/api/web/navigation')).json()).toEqual({ rigs: [], captures: [] })

    const added = await catalog.add({
      name: 'Offline Rig', endpoint: { host: 'offline.local', port: 11111 },
      inventory: { observedAt: '2026-09-01T20:00:00.000Z', devices: [{ uniqueId: 'camera', kind: 'camera', name: 'Camera' }] },
    })

    expect(added.state).toBe('added')

    if (added.state !== 'added') throw new Error('Expected new Rig')
    const response = await app.inject('/api/web/navigation')
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ rigs: [{ id: added.rig.id, name: 'Offline Rig' }], captures: [] })
    expect(createInspector).not.toHaveBeenCalled()
    expect(createInventory).not.toHaveBeenCalled()
    expect(count).not.toHaveBeenCalled()
    expect(list).not.toHaveBeenCalled()
  } finally {
    await app.close()
  }
})
