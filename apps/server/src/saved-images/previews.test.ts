import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import type { CaptureImage } from '@vela/model/web'
import { createMemoryRigCatalog } from '../rig/catalog.js'
import { encodeCaptureFits } from '../imaging/fits.js'
import { capturePreviews } from '../imaging/preview.js'
import { PREVIEW_VERSION } from '../imaging/background.js'
import { openFileSavedImageStore } from './store.js'
import { registerSavedImages } from './routes.js'

const roots: string[] = []

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

const image: CaptureImage = {
  id: 'retained',
  imageUrl: '/old-preview',
  width: 1602,
  height: 32,
  capturedAt: '2026-09-15T03:00:00.000Z',
  receivedAt: '2026-09-15T03:03:00.000Z',
  capturedAtSource: 'server-estimate',
  exposureSeconds: 180,
  cameraName: 'Retained camera',
  color: 'color',
  statistics: { detectedStars: 42, medianHfrPixels: 4 },
  saved: true,
}

async function setup(openFile = open) {
  const root = await mkdtemp(join(tmpdir(), 'vela-preview-'))
  roots.push(root)
  const catalog = createMemoryRigCatalog()

  const added = await catalog.add({
    name: 'Retained test',
    endpoint: { host: '127.0.0.1', port: 1 },
    inventory: { devices: [], observedAt: image.capturedAt },
  })

  if (added.state !== 'added') throw new Error('Fixture rig was not added')
  const { rig } = added
  const store = await openFileSavedImageStore(root, openFile)

  const pixels = Int32Array.from(
    { length: image.width * image.height },
    (_, i) => (i % 2 + Math.floor(i / image.width) % 2) % 2 ? 530 : 500,
  )

  const color = { kind: 'bayer', pattern: 'rggb' } as const

  const fits = await encodeCaptureFits(
    { ...image, color, pixels },
    { exposureSeconds: image.exposureSeconds, cameraName: image.cameraName },
  )

  const files = { fits, native: Buffer.from('first native bytes'), fit: Buffer.from('first fit bytes') }
  await store.save(rig.id, image, files)
  const directory = join(root, digest(rig.id), digest(image.id))

  return { root, rig, catalog, store, files, directory, pixels, color }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

it('lazily publishes a versioned native/fit pair, preserves every original byte/fact and survives reopening', async () => {
  const subject = await setup()
  const { store, rig, directory, files } = subject
  const before = await readFile(join(directory, 'metadata.json'))
  expect((await store.list(rig.id))[0]?.previewRendering).toEqual({ status: 'legacy' })
  expect(await readdir(directory)).not.toContain('previews')

  const [first, duplicate] = await Promise.all([
    store.refreshPreview(rig.id, image.id),
    store.refreshPreview(rig.id, image.id),
  ])

  expect(first).toEqual(duplicate)
  expect(first).toMatchObject({
    ...image,
    imageUrl: expect.stringContaining('/previews/background-v1/preview'),
    previewRendering: { status: 'current', version: PREVIEW_VERSION },
  })
  const expected = await capturePreviews(image.width, image.height, subject.pixels, subject.color)
  expect(await store.previewFile(rig.id, image.id, 'native')).toEqual(expected.native)
  expect(await store.previewFile(rig.id, image.id, 'fit')).toEqual(expected.fit)
  expect(await readFile(join(directory, 'metadata.json'))).toEqual(before)
  expect(await store.file(rig.id, image.id, 'fits')).toEqual(files.fits)
  expect(await store.file(rig.id, image.id, 'native')).toEqual(files.native)
  expect(await store.file(rig.id, image.id, 'fit')).toEqual(files.fit)
  const reopened = await openFileSavedImageStore(subject.root)
  expect((await reopened.list(rig.id))[0]).toEqual(first)
  expect(await reopened.refreshPreview(rig.id, image.id)).toEqual(first)
  const descriptor = JSON.parse(await readFile(join(directory, 'previews', PREVIEW_VERSION, 'manifest.json'), 'utf8'))
  expect(descriptor.fitsSha256).toBe(digest(files.fits))
})

it('shares an in-flight refresh, hides an incomplete pair and retains legacy after failed publication', async () => {
  let release!: () => void
  let started!: () => void
  const paused = new Promise<void>(resolve => { release = resolve })
  const writing = new Promise<void>(resolve => { started = resolve })
  let attempts = 0

  const openFile: typeof open = async (...args) => {
    const handle = await open(...args)

    if (String(args[0]).includes('/previews/.pending-') && String(args[0]).endsWith('/fit.png')) {
      attempts++
      vi.spyOn(handle, 'sync').mockImplementation(async () => {
        started()
        await paused
        throw new Error('simulated derivative disk failure')
      })
    }

    return handle
  }

  const { store, rig, directory } = await setup(openFile)
  const first = store.refreshPreview(rig.id, image.id)
  const duplicate = store.refreshPreview(rig.id, image.id)
  await writing
  expect((await store.list(rig.id))[0]?.previewRendering?.status).toBe('legacy')
  expect(await store.previewFile(rig.id, image.id, 'native')).toBeUndefined()
  release()
  expect((await first)?.previewRendering?.status).toBe('unavailable')
  expect(await duplicate).toEqual(await first)
  expect(attempts).toBe(1)
  expect(await readdir(join(directory, 'previews'))).toEqual([])
  const retry = await openFileSavedImageStore(directory + '/../..')
  expect((await retry.refreshPreview(rig.id, image.id))?.previewRendering?.status).toBe('current')
})

it('keeps unsupported originals viewable and pins old URLs while display/download share the refreshed bytes', async () => {
  const { store, rig, catalog, files } = await setup()
  const corrupt = { ...image, id: 'unsupported' }
  await store.save(rig.id, corrupt, { ...files, fits: Buffer.from('unsupported') })
  const app = Fastify()
  registerSavedImages(app, catalog, store)

  try {
    const base = `/api/rigs/${rig.id}/saved-images/${image.id}`
    const original = await app.inject(`${base}/preview`)
    const detail = await app.inject(`/api/web/rigs/${rig.id}/saved-images/${image.id}`)
    const refreshed = detail.json().image
    const display = await app.inject(refreshed.imageUrl)
    const download = await app.inject(refreshed.previewDownloadUrl)
    expect(display.rawPayload).toEqual(download.rawPayload)
    expect(display.headers['cache-control']).toContain('immutable')
    expect(download.headers['content-disposition']).toContain('attachment')
    expect((await app.inject(`${base}/preview`)).rawPayload).toEqual(original.rawPayload)
    expect((await app.inject(`${base}/fits`)).rawPayload).toEqual(files.fits)
    expect((await app.inject(`${base}/previews/future/preview`)).statusCode).toBe(404)
    const failed = (await app.inject(`/api/web/rigs/${rig.id}/saved-images/unsupported`)).json().image
    expect(failed.previewRendering).toEqual({ status: 'unavailable' })
    expect((await app.inject(failed.imageUrl)).rawPayload).toEqual(files.native)
    expect((await app.inject(failed.previewDownloadUrl)).rawPayload).toEqual(files.native)
  } finally {
    await app.close()
  }
})

it('marks fresh captures current without storing a second copy of their already-correct PNGs', async () => {
  const { store, rig, root, directory, pixels, color, files } = await setup()
  const rendered = await capturePreviews(image.width, image.height, pixels, color)

  const fresh = await store.save(
    rig.id,
    { ...image, id: 'fresh' },
    {
      ...files,
      native: rendered.native,
      fit: rendered.fit!,
      previewVersion: PREVIEW_VERSION,
    },
  )

  expect(fresh.previewRendering?.status).toBe('current')
  const reopened = await openFileSavedImageStore(root)
  expect(await reopened.get(rig.id, 'fresh')).toEqual(fresh)
  expect(await reopened.previewFile(rig.id, 'fresh', 'native')).toEqual(await reopened.file(rig.id, 'fresh', 'native'))
  const freshDirectory = join(directory, '..', digest('fresh'), 'previews', PREVIEW_VERSION)
  expect(await readdir(freshDirectory)).toEqual(['manifest.json'])
})
