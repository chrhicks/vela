// Device-free acceptance runtime. Uses production routes/controller/store with a retained-frame camera.
import Fastify from 'fastify'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout } from 'node:timers/promises'
import { corpus } from '../../workshop/preview-color/corpus.js'
import { createMemoryRigCatalog } from '../src/rig/catalog.js'
import { createRigOperations } from '../src/rig/operations.js'
import { registerSavedImages } from '../src/saved-images/routes.js'
import { openFileSavedImageStore } from '../src/saved-images/store.js'
import { registerCapture } from '../src/capture/routes.js'
import { registerNavigation } from '../src/navigation.js'
import { readRetainedFits } from '../src/imaging/read-retained-fits.js'
import { CaptureStoppedError } from '../src/capture/controller.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

const review = resolve(root, 'apps/workshop/.local/preview-adoption')

const rigId = '348c775f-d075-4cfe-90a3-b8e74d84b244'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

const savedPath = resolve(review, 'saved-images')

const sourcePath = (id: string) => resolve(root, 'data/saved-images', hash(rigId), hash(id))

await mkdir(savedPath, { recursive: true })

for (const fixture of corpus) {
  if (fixture.source) continue
  const destination = resolve(savedPath, hash(rigId), hash(fixture.id))

  if (await stat(resolve(destination, 'metadata.json')).catch(() => undefined)) continue
  await mkdir(destination, { recursive: true })

  for (const file of ['original.fits', 'preview.png', 'fit.png', 'metadata.json']) await copyFile(resolve(sourcePath(fixture.id), file), resolve(destination, file))
}

const store = await openFileSavedImageStore(savedPath)

const cooledId = '47d1a817-c7a6-4498-b064-ab29fb80e5ec'

const original = await readFile(resolve(sourcePath(cooledId), 'original.fits'))

const frame = await readRetainedFits(original)

const cameraName = 'Offline replay of 47d1a817 · no hardware'

const rig = {
  id: rigId, name: 'Preview review · retained-frame replay', endpoint: { host: '127.0.0.1', port: 1 },
  imagingCamera: { uniqueId: 'replay', name: cameraName }, addedAt: '2026-09-21T00:00:00.000Z',
  lastObservedInventory: { observedAt: '2026-09-21T00:00:00.000Z', devices: [{ uniqueId: 'replay', kind: 'camera' as const, name: cameraName }] },
}

const catalog = createMemoryRigCatalog([rig])

const app = Fastify()

const capture = registerCapture(app, catalog, createRigOperations(), {
  savedImages: store,
  createInspector: () => ({ async inspectDevices() {
    return [{ providerDeviceId: 'replay', kind: 'camera' as const, configuredName: cameraName, name: cameraName, connection: 'connected' as const,
      telemetry: { availability: 'complete' as const, values: { kind: 'camera' as const, activity: 'idle' as const } } }]
  } }),
  createCamera: () => ({ async capture({ signal, onProgress }) {
    onProgress({ phase: 'exposing', elapsedSeconds: 0 })

    try { await setTimeout(400, undefined, { signal }) }
    catch { throw new CaptureStoppedError() }

    return { ...frame, capturedAt: new Date().toISOString(), capturedAtSource: 'server-estimate' as const }
  } }),
  createCooling: () => { throw new Error('Cooling is unavailable in the device-free preview review') },
})

registerSavedImages(app, catalog, store)

registerNavigation(app, catalog, capture)

app.get('/api/health', async () => ({ status: 'ok', mode: 'device-free retained-frame replay' }))

const cooled = await store.get(rigId, cooledId)

if (!cooled) throw new Error('Missing copied cooled fixture')

await store.save(rigId, { ...cooled, id: 'unsupported-review-fixture', cameraName: 'Unsupported original · review fixture' }, {
  fits: Buffer.from('Deliberately unsupported review-only file; no retained original modified.'),
  native: await readFile(resolve(sourcePath(cooledId), 'preview.png')),
  fit: await readFile(resolve(sourcePath(cooledId), 'fit.png')),
})

await app.listen({ host: '127.0.0.1', port: 5192 })

console.log(`Device-free review: http://127.0.0.1:5193/rigs/${rigId}/observe/saved-images`)
