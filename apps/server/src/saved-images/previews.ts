import { z } from 'zod'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, open, readFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { SavedImage } from '@vela/model/web'
import { PREVIEW_VERSION } from '../imaging/background.js'
import { retainedFit, previewJpeg } from '../imaging/preview.js'
import { MAX_RETAINED_FITS_BYTES, readRetainedFits } from '../imaging/read-retained-fits.js'
import { syncDirectory, writeDurable } from './durable-files.js'

const descriptorSchema = z.object({
  source: z.enum(['original', 'derived']),
  fit: z.boolean(),
  fitsSha256: z.string().regex(/^[a-f0-9]{64}$/),
})

const versionDirectory = (directory: string) => join(directory, 'previews', PREVIEW_VERSION)

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

export function currentPreview(image: SavedImage, fit: boolean): SavedImage {
  const base = `/api/rigs/${encodeURIComponent(image.rigId)}/saved-images/${encodeURIComponent(image.id)}/previews/${PREVIEW_VERSION}`
  const { fitImageUrl: _fit, ...original } = image

  const current: SavedImage = {
    ...original,
    imageUrl: `${base}/preview`,
    previewDownloadUrl: `${base}/download-preview`,
    previewRendering: { status: 'current', version: PREVIEW_VERSION },
  }

  return fit ? { ...current, fitImageUrl: `${base}/fit` } : current
}

/** Published atomically with the new capture and its fitted PNG. */
export async function markCurrentPreview(
  directory: string,
  fits: Buffer,
  fit: boolean,
  openFile: typeof open,
) {
  const destination = versionDirectory(directory)
  await mkdir(destination, { recursive: true })
  await writeDurable(
    join(destination, 'manifest.json'),
    JSON.stringify({ source: 'original', fit, fitsSha256: sha256(fits) }),
    openFile,
  )
  await syncDirectory(destination)
  await syncDirectory(join(directory, 'previews'))
}

async function descriptor(directory: string) {
  for (const version of [PREVIEW_VERSION, 'background-v1']) {
    const versionPath = join(directory, 'previews', version)
    const path = join(versionPath, 'manifest.json')

    const info = await stat(path).catch(error => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })

    if (!info) continue

    if (!info.isFile() || info.size > 4096) throw new Error('Invalid saved-preview descriptor')
    const value = descriptorSchema.parse(JSON.parse(await readFile(path, 'utf8')))
    const source = value.source === 'original' ? directory : versionPath

    if (value.fit) {
      const fit = await stat(join(source, 'fit.png'))

      if (!fit.isFile() || fit.size === 0) throw new Error('Incomplete fitted preview')
    }

    return { ...value, directory: source }
  }

  return undefined
}

export function createRetainedPreviews(openFile: typeof open) {
  const pending = new Map<string, Promise<SavedImage>>()
  const renders = new Map<string, Promise<Buffer>>()
  // One original is decoded at a time. The queue retains only identities, not 26MP arrays.
  let queue = Promise.resolve()

  async function describe(directory: string, image: SavedImage): Promise<SavedImage> {
    try {
      const current = await descriptor(directory)

      return current
        ? currentPreview(image, current.fit)
        : { ...image, previewRendering: { status: 'legacy' } }
    } catch {
      return { ...image, previewRendering: { status: 'unavailable' } }
    }
  }

  async function refresh(directory: string, image: SavedImage): Promise<SavedImage> {
    try {
      const existing = await descriptor(directory)

      if (existing) return currentPreview(image, existing.fit)
      const fitsPath = join(directory, 'original.fits')
      const info = await stat(fitsPath)

      if (!info.isFile() || info.size > MAX_RETAINED_FITS_BYTES)
        throw new Error('Original FITS exceeds preview limits')
      const fits = await readFile(fitsPath)
      const frame = await readRetainedFits(fits)

      if (
        frame.width !== image.width ||
        frame.height !== image.height ||
        (frame.color.kind === 'mono' ? 'mono' : 'color') !== image.color
      )
        throw new Error('FITS does not match saved capture dimensions or color')
      const fit = await retainedFit(frame.width, frame.height, frame.pixels, frame.color)
      const parent = join(directory, 'previews')
      await mkdir(parent, { recursive: true })
      await syncDirectory(directory)
      const temporary = await mkdtemp(join(parent, '.pending-'))

      try {
        await writeDurable(join(temporary, 'fit.png'), fit, openFile)
        await writeDurable(
          join(temporary, 'manifest.json'),
          JSON.stringify({ source: 'derived', fit: true, fitsSha256: sha256(fits) }),
          openFile,
        )
        await syncDirectory(temporary)
        await rename(temporary, versionDirectory(directory))
        await syncDirectory(parent)
      } finally {
        await rm(temporary, { recursive: true, force: true })
      }

      return currentPreview(image, true)
    } catch (error) {
      console.warn(`Saved preview refresh unavailable for ${image.id}`, error)

      return { ...image, previewRendering: { status: 'unavailable' } }
    }
  }

  return {
    describe,
    refresh(directory: string, image: SavedImage) {
      const existing = pending.get(directory)

      if (existing) return existing

      const operation = queue
        .then(() => refresh(directory, image))
        .finally(() => pending.delete(directory))

      queue = operation.then(
        () => undefined,
        () => undefined,
      )
      pending.set(directory, operation)

      return operation
    },
    jpeg(directory: string, image: SavedImage) {
      const existing = renders.get(directory)

      if (existing) return existing

      const operation = queue.then(async () => {
        const path = join(directory, 'original.fits')
        const info = await stat(path)

        if (!info.isFile() || info.size > MAX_RETAINED_FITS_BYTES)
          throw new Error('Original FITS exceeds preview limits')
        const frame = await readRetainedFits(await readFile(path))

        if (frame.width !== image.width || frame.height !== image.height ||
          (frame.color.kind === 'mono' ? 'mono' : 'color') !== image.color)
          throw new Error('FITS does not match saved capture dimensions or color')

        return previewJpeg(frame.width, frame.height, frame.pixels, frame.color)
      }).finally(() => renders.delete(directory))

      queue = operation.then(() => undefined, () => undefined)
      renders.set(directory, operation)

      return operation
    },
    async file(directory: string) {
      const current = await descriptor(directory)

      if (!current?.fit) return undefined

      return readFile(join(current.directory, 'fit.png'))
    },
  }
}
