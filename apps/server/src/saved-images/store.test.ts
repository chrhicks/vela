import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as fs from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CaptureImage } from '@vela/model/web'
import { createMemorySavedImageStore, openFileSavedImageStore } from './store.js'

const image: CaptureImage = {
  id: 'frame-1',
  imageUrl: '/temporary.png',
  fitImageUrl: '/temporary-fit.png',
  width: 3,
  height: 2,
  exposureSeconds: 10,
  capturedAt: '2026-09-05T23:00:00.000Z',
  receivedAt: '2026-09-05T23:00:10.000Z',
  cameraName: 'Camera',
  color: 'mono',
  statistics: null,
  saved: false,
}

const files = {
  fits: Buffer.from('original'),
  native: Buffer.from('preview'),
  fit: Buffer.from('small'),
}

const directories: string[] = []

async function temporary() {
  const path = await mkdtemp(join(tmpdir(), 'vela-saved-test-'))
  directories.push(path)

  return path
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('saved image store', () => {
  it.each(['memory', 'file'])(
    '%s preserves one artifact per rig/frame with isolated downloads',
    async kind => {
      const store =
        kind === 'memory'
          ? createMemorySavedImageStore()
          : await openFileSavedImageStore(await temporary())

      const [first, duplicate] = await Promise.all([
        store.save('rig/../one', image, files),
        store.save('rig/../one', image, files),
      ])

      expect(duplicate).toEqual(first)
      expect(first).toMatchObject({ saved: true, rigId: 'rig/../one', id: image.id })
      expect(first.imageUrl).toBe('/api/rigs/rig%2F..%2Fone/saved-images/frame-1/preview')
      expect(first.fitImageUrl).toBe('/api/rigs/rig%2F..%2Fone/saved-images/frame-1/fit')
      expect(await store.count('rig/../one')).toBe(1)
      expect(await store.get('other-rig', image.id)).toBeUndefined()
      expect(await store.file('other-rig', image.id, 'fits')).toBeUndefined()
      expect(await store.file('rig/../one', image.id, 'fits')).toEqual(files.fits)
      expect(await store.file('rig/../one', image.id, 'native')).toEqual(files.native)
      expect(await store.file('rig/../one', image.id, 'fit')).toEqual(files.fit)
      await store.save(
        'rig/../one',
        { ...image, id: '../next', capturedAt: '2026-09-05T20:00:00-04:00' },
        { fits: files.fits, native: files.native },
      )
      expect((await store.list('rig/../one')).map(item => item.id)).toEqual(['../next', 'frame-1'])
      expect((await store.get('rig/../one', '../next'))?.fitImageUrl).toBeUndefined()
      expect(await store.file('rig/../one', '../next', 'fit')).toBeUndefined()
    },
  )

  it('survives reopening, hides interrupted staging saves, and arbitrates independent concurrent stores', async () => {
    const root = await temporary()
    const first = await openFileSavedImageStore(root)
    const second = await openFileSavedImageStore(root)

    const [saved, duplicate] = await Promise.all([
      first.save('rig', image, files),
      second.save('rig', image, files),
    ])

    expect(saved).toEqual(duplicate)
    const rigDirectory = join(root, createHash('sha256').update('rig').digest('hex'))
    await mkdir(join(rigDirectory, '.pending-interrupted'))
    await writeFile(join(rigDirectory, '.pending-interrupted', 'original.fits'), 'partial')
    const reopened = await openFileSavedImageStore(root)
    expect(await reopened.list('rig')).toEqual([saved])
    expect(await reopened.file('rig', image.id, 'fits')).toEqual(files.fits)
    expect((await readdir(rigDirectory)).filter(name => !name.startsWith('.'))).toHaveLength(1)
  })

  it('reports a write failure without publishing an artifact and permits a later retry', async () => {
    const root = await temporary()
    const store = await openFileSavedImageStore(root)
    const rigDirectory = join(root, createHash('sha256').update('rig').digest('hex'))
    await writeFile(rigDirectory, 'blocks directory creation')
    await expect(store.save('rig', image, files)).rejects.toThrow('Could not save image frame-1')
    await rm(rigDirectory)
    expect(await store.list('rig')).toEqual([])
    await store.save('rig', image, files)
    expect(await store.count('rig')).toBe(1)
  })

  it('never exposes partially written files when a later file sync fails', async () => {
    const root = await temporary()
    const realOpen = fs.open
    let announce!: () => void
    let fail!: (reason: Error) => void

    const writing = new Promise<void>(resolve => {
      announce = resolve
    })

    const sync = new Promise<void>((_, reject) => {
      fail = reject
    })

    const openFile: typeof fs.open = async (...args) => {
      const handle = await realOpen(...args)

      if (String(args[0]).endsWith('/preview.png')) {
        vi.spyOn(handle, 'sync').mockImplementation(() => {
          announce()

          return sync
        })
      }

      return handle
    }

    const store = await openFileSavedImageStore(root, openFile)
    const pending = store.save('rig', image, files)
    const rejection = expect(pending).rejects.toThrow('simulated disk failure')
    await writing
    expect(await store.list('rig')).toEqual([])
    expect(await store.count('rig')).toBe(0)
    expect(await store.file('rig', image.id, 'fits')).toBeUndefined()
    fail(new Error('simulated disk failure'))
    await rejection
    expect(await store.list('rig')).toEqual([])
    const rigDirectory = join(root, createHash('sha256').update('rig').digest('hex'))
    expect(await readdir(rigDirectory)).toEqual([])
  })
})

it('preserves estimated starts on disk and rejects unknown provenance without rewriting legacy metadata', async () => {
  const root = await temporary()
  const store = await openFileSavedImageStore(root)
  const saved = await store.save('rig', { ...image, capturedAtSource: 'server-estimate' }, files)
  const reopened = await openFileSavedImageStore(root)
  expect(await reopened.get('rig', image.id)).toMatchObject({ capturedAtSource: 'server-estimate' })

  const metadataPath = join(
    root,
    createHash('sha256').update('rig').digest('hex'),
    createHash('sha256').update(image.id).digest('hex'),
    'metadata.json',
  )

  await writeFile(metadataPath, JSON.stringify({ ...saved, capturedAtSource: 'unknown' }))
  await expect(reopened.get('rig', image.id)).rejects.toThrow('Invalid saved image metadata')
  const { capturedAtSource: _capturedAtSource, ...legacy } = saved
  const legacyText = JSON.stringify(legacy)
  await writeFile(metadataPath, legacyText)
  expect((await reopened.get('rig', image.id))?.capturedAtSource).toBeUndefined()
  expect(await fs.readFile(metadataPath, 'utf8')).toBe(legacyText)
})
