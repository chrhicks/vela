import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import sharp from 'sharp'
import type { CaptureImage } from '@vela/model/web'
import { createMemoryRigCatalog } from '../rig/catalog.js'
import { encodeCaptureFits } from '../imaging/fits.js'
import * as retained from '../imaging/read-retained-fits.js'
import { retainedFit } from '../imaging/preview.js'
import { PREVIEW_VERSION } from '../imaging/background.js'
import { openFileSavedImageStore } from './store.js'
import { registerSavedImages } from './routes.js'

const roots: string[] = []

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

const image: CaptureImage = {
  id: 'retained', frameType: 'light', imageUrl: '/old-preview', width: 1602, height: 32,
  capturedAt: '2026-09-15T03:00:00.000Z', receivedAt: '2026-09-15T03:03:00.000Z',
  exposureSeconds: 180, cameraName: 'Retained camera', color: 'color', statistics: null, saved: true,
}

async function setup(current = false) {
  const root = await mkdtemp(join(tmpdir(), 'vela-preview-'))
  roots.push(root)
  const catalog = createMemoryRigCatalog()

  const added = await catalog.add({
    name: 'Retained test', endpoint: { host: '127.0.0.1', port: 1 },
    inventory: { devices: [], observedAt: image.capturedAt },
  })

  if (added.state !== 'added') throw new Error('Fixture rig was not added')
  const { rig } = added
  const store = await openFileSavedImageStore(root)
  const pixels = Int32Array.from({ length: image.width * image.height }, (_, i) => 500 + i % 40)
  const color = { kind: 'bayer', pattern: 'rggb' } as const

  const fits = await encodeCaptureFits(
    { ...image, color, pixels },
    { exposureSeconds: image.exposureSeconds, cameraName: image.cameraName },
  )

  const files = { fits, fit: Buffer.from('stored fit') }
  const saved = await store.save(rig.id, image, current ? { ...files, previewVersion: PREVIEW_VERSION } : files)
  const directory = join(root, digest(rig.id), digest(image.id))
  const app = Fastify()
  registerSavedImages(app, catalog, store)

  return { root, rig, store, files, directory, pixels, color, saved, app }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

it('saves only FITS, fitted PNG and metadata, and refresh publishes only a fit and descriptor', async () => {
  const { store, rig, directory, files, pixels, color, app } = await setup()

  try {
    expect(await readdir(directory)).toEqual(['fit.png', 'metadata.json', 'original.fits'])
    const before = await readFile(join(directory, 'metadata.json'))
    const refreshed = await store.refreshPreview(rig.id, image.id)
    expect(refreshed?.previewRendering).toEqual({ status: 'current', version: PREVIEW_VERSION })
    expect(await readdir(join(directory, 'previews', PREVIEW_VERSION))).toEqual(['fit.png', 'manifest.json'])
    expect(await store.previewFile(rig.id, image.id, 'fit')).toEqual(await retainedFit(image.width, image.height, pixels, color))
    expect(await store.file(rig.id, image.id, 'fits')).toEqual(files.fits)
    expect(await readFile(join(directory, 'metadata.json'))).toEqual(before)
  } finally { await app.close() }
})

it('serves decoded native-size JPEGs from all full-size routes without writing a cache', async () => {
  const { app, saved, directory } = await setup(true)

  try {
    const before = await readdir(directory, { recursive: true })
    const base = saved.imageUrl.split('/previews/')[0]

    for (const url of [saved.imageUrl, saved.previewDownloadUrl, `${base}/preview`, `${base}/download-preview`]) {
      const response = await app.inject(url)
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toBe('image/jpeg')
      const decoded = await sharp(response.rawPayload).raw().toBuffer({ resolveWithObject: true })
      expect(decoded.info).toMatchObject({ width: image.width, height: image.height, channels: 3 })
      expect(decoded.data.length).toBe(image.width * image.height * 3)

      if (url.includes('download')) expect(response.headers['content-disposition']).toContain('.jpg"')
    }

    expect(await readdir(directory, { recursive: true })).toEqual(before)
  } finally { await app.close() }
})

it('shares concurrent renders, queues distinct frames, and releases completed results', async () => {
  const { store, rig, app, files, saved } = await setup(true)
  await store.save(rig.id, { ...image, id: 'other' }, { ...files, previewVersion: PREVIEW_VERSION })
  const decode = retained.readRetainedFits
  let release!: () => void
  let started!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const entered = new Promise<void>(resolve => { started = resolve })
  let active = 0
  let maximum = 0

  const spy = vi.spyOn(retained, 'readRetainedFits').mockImplementation(async bytes => {
    active++
    maximum = Math.max(maximum, active)
    started()
    await gate

    try { return await decode(bytes) } finally { active-- }
  })

  try {
    const first = app.inject(saved.imageUrl)
    const duplicate = app.inject(saved.previewDownloadUrl)
    const other = app.inject(saved.imageUrl.replace('/retained/', '/other/'))
    const responses = Promise.all([first, duplicate, other])
    await entered
    expect(spy).toHaveBeenCalledTimes(1)
    release()
    const result = await responses
    expect(result.map(value => value.statusCode)).toEqual([200, 200, 200])
    expect(result[0]!.rawPayload).toEqual(result[1]!.rawPayload)
    expect(spy).toHaveBeenCalledTimes(2)
    expect(maximum).toBe(1)
    await app.inject(saved.imageUrl)
    expect(spy).toHaveBeenCalledTimes(3)
  } finally { release(); await app.close() }
})

it.each(['missing', 'unreadable'])('returns the unavailable answer for a %s original', async failure => {
  const { app, directory, saved } = await setup(true)

  if (failure === 'missing') await rm(join(directory, 'original.fits'))
  else await writeFile(join(directory, 'original.fits'), 'invalid FITS')

  try {
    const response = await app.inject(saved.imageUrl)
    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'Saved file is unavailable. Check storage and try again.' })
  } finally { await app.close() }
})

it('lists the library and serves fitted thumbnails without decoding a FITS', async () => {
  const { app, rig, files, store } = await setup(true)
  const spy = vi.spyOn(retained, 'readRetainedFits')

  try {
    const response = await app.inject(`/api/web/rigs/${rig.id}/saved-images`)
    expect(response.statusCode).toBe(200)

    for (const saved of response.json().images) {
      expect((await app.inject(saved.fitImageUrl)).rawPayload).toEqual(files.fit)
    }

    await store.list(rig.id)
    expect(spy).not.toHaveBeenCalled()
  } finally { await app.close() }
})

it('uses either old descriptor layout without reading an old preview.png or refreshing it', async () => {
  const { store, rig, directory, files, app } = await setup()

  try {
    for (const source of ['original', 'derived']) {
      const old = join(directory, 'previews', 'background-v1')
      await mkdir(old, { recursive: true })
      await writeFile(join(old, 'manifest.json'), JSON.stringify({ source, fit: true, fitsSha256: digest(files.fits) }))
      await writeFile(join(old, 'fit.png'), files.fit)
      const spy = vi.spyOn(retained, 'readRetainedFits')
      const refreshed = await store.refreshPreview(rig.id, image.id)
      expect(refreshed?.previewRendering?.status).toBe('current')
      expect(await store.previewFile(rig.id, image.id, 'fit')).toEqual(files.fit)
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
      expect((await app.inject(`/api/rigs/${rig.id}/saved-images/${image.id}/previews/background-v1/preview`)).statusCode).toBe(200)
    }
  } finally { await app.close() }
})
