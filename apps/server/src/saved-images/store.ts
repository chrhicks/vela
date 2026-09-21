import { z } from 'zod'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { CaptureImage, SavedImage } from '@vela/model/web'
import { PREVIEW_VERSION } from '../imaging/background.js'
import { createRetainedPreviews, currentPreview, markCurrentPreview } from './previews.js'
import { syncDirectory, writeDurable } from './durable-files.js'

export type SavedImageFiles = {
  fits: Buffer
  native: Buffer
  fit?: Buffer
  previewVersion?: typeof PREVIEW_VERSION
}

type FileKind = 'fits' | 'native' | 'fit'

const filenames = { fits: 'original.fits', native: 'preview.png', fit: 'fit.png' }

export interface SavedImageStore {
  save(rigId: string, image: CaptureImage, files: SavedImageFiles): Promise<SavedImage>
  list(rigId: string): Promise<SavedImage[]>
  count(rigId: string): Promise<number>
  get(rigId: string, imageId: string): Promise<SavedImage | undefined>
  file(rigId: string, imageId: string, kind: FileKind): Promise<Buffer | undefined>
  refreshPreview(rigId: string, imageId: string): Promise<SavedImage | undefined>
  previewFile(rigId: string, imageId: string, kind: 'native' | 'fit'): Promise<Buffer | undefined>
}

function metadata(rigId: string, image: CaptureImage, files: SavedImageFiles): SavedImage {
  const url = `/api/rigs/${encodeURIComponent(rigId)}/saved-images/${encodeURIComponent(image.id)}`
  const { fitImageUrl: _fitImageUrl, ...original } = image

  const saved: SavedImage = {
    ...original,
    rigId,
    saved: true,
    savedAt: new Date().toISOString(),
    imageUrl: `${url}/preview`,
    fitsUrl: `${url}/fits`,
    previewDownloadUrl: `${url}/download-preview`,
  }

  return files.fit ? { ...saved, fitImageUrl: `${url}/fit` } : saved
}

function newest(images: SavedImage[]) {
  return images.sort(
    (a, b) =>
      Date.parse(b.capturedAt) - Date.parse(a.capturedAt) ||
      Date.parse(b.savedAt) - Date.parse(a.savedAt),
  )
}

export function createMemorySavedImageStore(): SavedImageStore {
  const rigs = new Map<string, Map<string, { image: SavedImage; files: SavedImageFiles }>>()

  return {
    async save(rigId, image, files) {
      let rig = rigs.get(rigId)

      if (!rig) {
        rig = new Map()
        rigs.set(rigId, rig)
      }

      const existing = rig.get(image.id)

      if (existing) return structuredClone(existing.image)
      const original = metadata(rigId, image, files)

      const saved =
        files.previewVersion === PREVIEW_VERSION ? currentPreview(original, !!files.fit) : original

      const copied: SavedImageFiles = {
        fits: Buffer.from(files.fits),
        native: Buffer.from(files.native),
      }

      if (files.fit) copied.fit = Buffer.from(files.fit)
      rig.set(image.id, { image: saved, files: copied })

      return structuredClone(saved)
    },
    async list(rigId) {
      return newest(
        Array.from(rigs.get(rigId)?.values() ?? [], item => structuredClone(item.image)),
      )
    },
    async count(rigId) {
      return rigs.get(rigId)?.size ?? 0
    },
    async get(rigId, imageId) {
      return structuredClone(rigs.get(rigId)?.get(imageId)?.image)
    },
    async refreshPreview(rigId, imageId) {
      return this.get(rigId, imageId)
    },
    async previewFile(rigId, imageId, kind) {
      const entry = rigs.get(rigId)?.get(imageId)

      if (entry?.image.previewRendering?.status !== 'current') return undefined

      return this.file(rigId, imageId, kind)
    },
    async file(rigId, imageId, kind) {
      const file = rigs.get(rigId)?.get(imageId)?.files[kind]

      return file && Buffer.from(file)
    },
  }
}

export async function openFileSavedImageStore(
  path: string,
  openFile: typeof open = open,
): Promise<SavedImageStore> {
  await mkdir(path, { recursive: true })
  const pending = new Map<string, Promise<SavedImage>>()
  const previews = createRetainedPreviews(openFile)
  const rigPath = (rigId: string) => join(path, digest(rigId))
  const imagePath = (rigId: string, imageId: string) => join(rigPath(rigId), digest(imageId))

  const get = async (rigId: string, imageId: string) => {
    const directory = imagePath(rigId, imageId)
    const image = await readMetadata(directory, rigId, imageId)

    return image && previews.describe(directory, image)
  }

  const completedDirectories = async (rigId: string) => {
    const entries = await readdir(rigPath(rigId), { withFileTypes: true }).catch(error => {
      if (missing(error)) return []
      throw error
    })

    return entries.filter(entry => entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name))
  }

  const list = async (rigId: string) => {
    const entries = await completedDirectories(rigId)
    const images: SavedImage[] = []

    for (const entry of entries) {
      const image = await readMetadata(join(rigPath(rigId), entry.name), rigId)

      if (!image || digest(image.id) !== entry.name)
        throw new Error('Saved image metadata does not match its directory')
      images.push(await previews.describe(join(rigPath(rigId), entry.name), image))
    }

    return newest(images)
  }

  const save = async (rigId: string, image: CaptureImage, files: SavedImageFiles) => {
    const existing = await get(rigId, image.id)

    if (existing) return existing
    const directory = rigPath(rigId)
    await mkdir(directory, { recursive: true })
    await syncDirectory(path)
    const temporary = await mkdtemp(join(directory, '.pending-'))

    try {
      const saved = metadata(rigId, image, files)

      for (const kind of ['fits', 'native', 'fit'] as const) {
        if (files[kind])
          await writeDurable(join(temporary, filenames[kind]), files[kind]!, openFile)
      }

      await writeDurable(join(temporary, 'metadata.json'), JSON.stringify(saved), openFile)

      if (files.previewVersion === PREVIEW_VERSION)
        await markCurrentPreview(temporary, files.fits, !!files.fit, openFile)
      await syncDirectory(temporary)

      try {
        await rename(temporary, imagePath(rigId, image.id))
      } catch (error) {
        // A second store instance may have completed the same frame first.
        if (!['EEXIST', 'ENOTEMPTY'].includes(fileErrorCode.parse(error) ?? '')) throw error
        const winner = await get(rigId, image.id)

        if (!winner) throw error

        return winner
      }

      await syncDirectory(directory)

      return previews.describe(imagePath(rigId, image.id), saved)
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  }

  return {
    save(rigId, image, files) {
      const key = `${digest(rigId)}/${digest(image.id)}`
      const current = pending.get(key)

      if (current) return current

      const operation = save(rigId, image, files)
        .catch(error => {
          throw new Error(
            `Could not save image ${image.id}: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          )
        })
        .finally(() => pending.delete(key))

      pending.set(key, operation)

      return operation
    },
    list,
    async count(rigId) {
      return (await completedDirectories(rigId)).length
    },
    get,
    async refreshPreview(rigId, imageId) {
      const directory = imagePath(rigId, imageId)
      const image = await readMetadata(directory, rigId, imageId)

      return image && previews.refresh(directory, image)
    },
    async previewFile(rigId, imageId, kind) {
      if (!(await get(rigId, imageId))) return undefined

      return previews.file(imagePath(rigId, imageId), kind)
    },
    async file(rigId, imageId, kind) {
      const image = await readMetadata(imagePath(rigId, imageId), rigId, imageId)

      if (!image || (kind === 'fit' && !image.fitImageUrl)) return undefined

      return readFile(join(imagePath(rigId, imageId), filenames[kind]))
    },
  }
}

function digest(id: string) {
  return createHash('sha256').update(id).digest('hex')
}

const fileErrorCode = z
  .object({ code: z.string() })
  .transform(error => error.code)
  .optional()
  .catch(undefined)

function missing(error: unknown): error is NodeJS.ErrnoException {
  return fileErrorCode.parse(error) === 'ENOENT'
}

async function readMetadata(
  directory: string,
  rigId: string,
  imageId?: string,
): Promise<SavedImage | undefined> {
  let text: string

  try {
    text = await readFile(join(directory, 'metadata.json'), 'utf8')
  } catch (error) {
    if (missing(error)) return undefined
    throw error
  }

  const parsed = savedImageSchema.safeParse(JSON.parse(text))

  if (
    !parsed.success ||
    parsed.data.rigId !== rigId ||
    (imageId !== undefined && parsed.data.id !== imageId)
  ) {
    throw new Error(`Invalid saved image metadata in ${directory}`)
  }

  const image = parsed.data

  for (const filename of [
    filenames.fits,
    filenames.native,
    ...(image.fitImageUrl ? [filenames.fit] : []),
  ]) {
    if (!(await stat(join(directory, filename))).isFile())
      throw new Error(`Missing saved image file ${filename}`)
  }

  // Reconstruct URLs rather than trusting persisted URLs as navigation targets.
  const url = `/api/rigs/${encodeURIComponent(rigId)}/saved-images/${encodeURIComponent(image.id)}`
  const { fitImageUrl, ...original } = image

  const saved = {
    ...original,
    imageUrl: `${url}/preview`,
    fitsUrl: `${url}/fits`,
    previewDownloadUrl: `${url}/download-preview`,
  }

  return fitImageUrl ? { ...saved, fitImageUrl: `${url}/fit` } : saved
}

const timestamp = z.string().refine(value => Number.isFinite(Date.parse(value)))

const savedImageSchema = z
  .object({
    id: z.string(),
    rigId: z.string(),
    saved: z.literal(true),
    savedAt: timestamp,
    capturedAt: timestamp,
    receivedAt: timestamp,
    capturedAtSource: z.enum(['camera', 'server-estimate']).optional(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    cameraName: z.string(),
    exposureSeconds: z.number().nonnegative(),
    color: z.enum(['mono', 'color']),
    statistics: z
      .object({
        detectedStars: z.number().int().nonnegative(),
        medianHfrPixels: z.number().nonnegative().nullable(),
      })
      .nullable(),
    imageUrl: z.string(),
    fitImageUrl: z.string().optional(),
    fitsUrl: z.string(),
    previewDownloadUrl: z.string(),
  })
  .transform(({ capturedAtSource, fitImageUrl, ...required }): SavedImage => {
    let image: SavedImage = required

    if (capturedAtSource !== undefined) image = { ...image, capturedAtSource }

    if (fitImageUrl !== undefined) image = { ...image, fitImageUrl }

    return image
  })
