import { mkdtemp, readdir, rm, stat, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { frame, imageIdOf, solved, steady, testRig } from '../../../packages/rig-testing/src/index.js'
import { epochMs } from '../../../packages/rig-events/src/index.js'
import { createModelHost } from '../../server/src/rig-model/host.js'
import { createStreamModel } from '../../server/src/rig-model/stream.js'
import { checkpointStore } from '../../server/src/rig-model/checkpoint.js'
import { shadowCheckpoint } from '../../server/src/rig-model/view.js'
import { buildApp } from '../../server/src/app.js'
import { createMemoryRigCatalog } from '../../server/src/rig/catalog.js'

it('reads the real shadow checkpoint without writes and labels stale or absent data separately from local Aim', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'model-view-'))
  const start = Date.now()
  const runtime = createStreamModel()
  const local = createModelHost(undefined, () => start)
  const catalog = createMemoryRigCatalog()
  await local.ready
  await catalog.add({ id: testRig, name: 'Synthetic', endpoint: { host: 'localhost', port: 1 }, inventory: { observedAt: new Date(start).toISOString(), devices: [] } })
  const app = buildApp({ rigCatalog: catalog, models: local, shadowStateDirectory: directory, now: () => new Date(start + 6000) })

  try {
    expect((await app.inject(`/api/web/rigs/${testRig}/model`)).statusCode).toBe(503)
    const events = steady({ from: start, to: start + 5000, mount: { at: start, raHours: 2, decDegrees: 0, frame: 'j2000' } })

    for (const event of events) { runtime.accept(event); local.onAppend(event) }

    const image = imageIdOf(1)
    runtime.accept(frame({ image, capturedAt: start + 1000, exposureSeconds: 2, seenAt: start + 3000 }))
    runtime.accept(solved(image, { raDegrees: 30.001, decDegrees: 0 }, start + 6000))
    const state = runtime.snapshot()
    const entry = state.rigs.get(testRig)!
    const fix = entry.model.fixes[0]!
    const many = Array.from({ length: 50 }, (_, i) => ({ ...fix, imageId: imageIdOf(i + 1), at: epochMs(start + i) }))
    await checkpointStore(directory).save({ ...state, rigs: new Map([[testRig, { ...entry, model: { ...entry.model, fixes: many, counters: { ...entry.model.counters, fixes: 50 } } }]]) })
    const before = await Promise.all((await readdir(directory)).map(async name => [name, (await stat(join(directory, name))).mtimeMs]))
    const response = await app.inject(`/api/web/rigs/${testRig}/model`)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ local: { position: { state: 'unknown' } }, shadow: { state: 'available', snapshot: { position: { state: 'known' }, fixCount: 50 } } })
    expect(response.json().shadow.snapshot.fixes).toHaveLength(30)
    expect(response.json().shadow.snapshot.fixes[0].imageId).toBe(imageIdOf(21))
    expect(response.body).not.toContain('latitude')
    expect(await Promise.all((await readdir(directory)).map(async name => [name, (await stat(join(directory, name))).mtimeMs]))).toEqual(before)
    const old = new Date(start - 60_000)
    await utimes(join(directory, 'checkpoint.json'), old, old)
    expect((await shadowCheckpoint(directory)(testRig, start)).state).toBe('unavailable')
    expect((await shadowCheckpoint(undefined)(testRig, start)).snapshot).toBeNull()
    expect((await app.inject('/api/web/rigs/missing/model')).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: `/api/web/rigs/${testRig}/model` })).statusCode).toBe(404)
  } finally {
    await app.close()
    local.close()
    await rm(directory, { recursive: true, force: true })
  }
})
