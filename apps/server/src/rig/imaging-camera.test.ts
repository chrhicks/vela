import Fastify from 'fastify'
import { expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMemoryRigCatalog, openFileRigCatalog } from './catalog.js'
import { createRigOperations } from './operations.js'
import { registerImagingCamera } from './imaging-camera.js'

const rig = {
  id: 'rig', name: 'Rig', endpoint: { host: 'localhost', port: 11111 }, addedAt: '2026-09-01T00:00:00.000Z',
  lastObservedInventory: { observedAt: '2026-09-01T00:00:00.000Z', devices: [{ uniqueId: 'slot', kind: 'camera' as const, name: 'Slot' }] },
}

it('persists selected identity separately from replaceable inventory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vela-camera-'))
  try {
    const path = join(directory, 'rigs.yaml')
    const catalog = await openFileRigCatalog(path, { createId: () => 'rig' })
    await catalog.add({ name: rig.name, endpoint: rig.endpoint, inventory: rig.lastObservedInventory })
    await catalog.setImagingCamera('rig', { uniqueId: 'slot', name: 'Main camera' })
    await catalog.observe(rig.endpoint, { ...rig.lastObservedInventory, devices: [] })
    expect((await (await openFileRigCatalog(path)).get('rig'))?.imagingCamera).toEqual({ uniqueId: 'slot', name: 'Main camera' })
    expect(await catalog.setImagingCamera('unknown', { uniqueId: 'slot', name: 'Camera' })).toBe(false)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('requires explicit current identity and excludes selection changes during rig work', async () => {
  const app = Fastify()
  const catalog = createMemoryRigCatalog([rig])
  const operations = createRigOperations()
  let name = 'Main camera'
  let present = true
  registerImagingCamera(app, catalog, operations, { createInspector: () => ({ async inspectDevices() {
    return present ? [{ providerDeviceId: 'slot', configuredName: 'Slot', name, kind: 'camera' as const,
      connection: 'connected' as const, telemetry: { availability: 'complete' as const, values: { kind: 'camera' as const, activity: 'idle' as const } } }] : []
  } }) })
  const get = () => app.inject('/api/web/rigs/rig/imaging-camera')
  const put = (cameraName = name) => app.inject({ method: 'PUT', url: '/api/rigs/rig/imaging-camera', payload: { id: 'slot', name: cameraName } })
  try {
    expect((await get()).json()).toMatchObject({ selected: null, state: 'unselected', editable: true })
    expect((await put()).statusCode).toBe(200)
    expect((await get()).json()).toMatchObject({ selected: { id: 'slot', name }, state: 'ready' })
    const release = operations.acquire('rig', 'capture')!
    expect((await put()).statusCode).toBe(409)
    expect((await get()).json().editable).toBe(false)
    release()
    name = 'Guide camera'
    expect((await get()).json().state).toBe('changed')
    expect((await put('Main camera')).statusCode).toBe(409)
    expect((await put()).statusCode).toBe(200)
    present = false
    expect((await get()).json()).toMatchObject({ selected: { name: 'Guide camera' }, state: 'missing' })
    expect((await put()).statusCode).toBe(409)
  } finally { await app.close() }
})
