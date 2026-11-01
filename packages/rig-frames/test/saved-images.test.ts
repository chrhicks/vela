import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { imageIdOf } from '@vela/rig-testing'
import { readSavedImages } from '@vela/rig-frames'
import { dataDirectory, rigName, sha256, writeImage } from './support.ts'

describe('readSavedImages', () => {
  it('reads each finished image and defaults a missing frame type to light', async () => {
    const dir = await dataDirectory()
    await writeImage(dir, { index: 1, capturedAt: '2026-10-26T20:00:00.000Z' })
    await writeImage(dir, { index: 2, capturedAt: '2026-10-26T20:00:20.000Z', frameType: 'dark', exposureSeconds: 30 })

    const { images, problems } = await readSavedImages(join(dir, 'saved-images'))

    expect(problems).toEqual([])
    expect(images.map(image => [image.id, image.frameType, image.exposureSeconds, image.capturedAtSource, image.fitsBytes])).toEqual([
      [imageIdOf(1), 'light', 10, 'camera', 2880],
      [imageIdOf(2), 'dark', 30, 'camera', 2880],
    ].sort((a, b) => sha256(String(a[0])).localeCompare(sha256(String(b[0])))))
  })

  it('skips an unfinished save and reports a finished image that is damaged', async () => {
    const dir = await dataDirectory()
    const root = join(dir, 'saved-images')
    await writeImage(dir, { index: 1, capturedAt: '2026-10-26T20:00:00.000Z' })
    await mkdir(join(root, sha256(rigName), '.pending-abc123'), { recursive: true })

    const renamed = await writeImage(dir, { index: 2, capturedAt: '2026-10-26T20:00:20.000Z' }, sha256('some other id'))
    const withoutFits = await writeImage(dir, { index: 3, capturedAt: '2026-10-26T20:00:40.000Z' })
    await rm(join(withoutFits, 'original.fits'))
    const unreadable = await writeImage(dir, { index: 4, capturedAt: '2026-10-26T20:01:00.000Z' })
    await writeFile(join(unreadable, 'metadata.json'), '{ not json')

    const { images, problems } = await readSavedImages(root)

    expect(images.map(image => image.id)).toEqual([imageIdOf(1)])
    expect(problems.map(problem => [problem.path, problem.reason]).sort()).toEqual(
      [
        [renamed, 'directory name does not match the metadata'],
        [withoutFits, 'ENOENT'],
        [unreadable, 'not JSON'],
      ].sort(),
    )
  })

  it('reports a store that is not there instead of listing nothing', async () => {
    const dir = await dataDirectory()

    expect((await readSavedImages(join(dir, 'saved-images'))).problems.map(problem => problem.reason)).toEqual(['ENOENT'])
  })
})
