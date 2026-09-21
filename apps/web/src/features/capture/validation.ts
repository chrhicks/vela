import { z } from 'zod'
import type { CaptureImage, CaptureView, SavedImage, SavedImagesView, SavedImageView } from '@vela/model/web'

const text = z.string().refine(value => value.trim().length > 0)

const timestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T.+Z$/).refine(value => Number.isFinite(Date.parse(value)))

const statistics = z.object({
  detectedStars: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  medianHfrPixels: z.number().positive().nullable(),
}).refine(value => value.detectedStars === 0 ? value.medianHfrPixels === null : value.medianHfrPixels !== null).nullable()

const captureImage = z.object({
  id: text,
  cameraName: text,
  saved: z.boolean(),
  imageUrl: z.string(),
  fitImageUrl: z.string().optional(),
  color: z.enum(['mono', 'color']),
  width: z.number().refine(Number.isInteger).positive(),
  height: z.number().refine(Number.isInteger).positive(),
  exposureSeconds: z.number().min(0.1).max(600),
  statistics,
  capturedAtSource: z.enum(['camera', 'server-estimate']).optional(),
  capturedAt: timestamp,
  receivedAt: timestamp,
}).refine(value => Date.parse(value.receivedAt) >= Date.parse(value.capturedAt))

const captureView = z.object({
  rigId: z.string(),
  rigName: text,
  camera: z.object({ name: text }).nullable(),
  enabled: z.boolean(),
  unavailableReason: text.nullable(),
  phase: z.enum(['idle', 'exposing', 'reading', 'saving', 'stopping', 'complete', 'stopped', 'failed']),
  active: z.boolean(),
  captureReadState: z.enum(['current', 'retrying']),
  exposureSeconds: z.number().min(0).max(600),
  repeat: z.boolean(),
  completedCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  saveFrames: z.boolean(),
  savedImageCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  elapsedSeconds: z.number().nonnegative(),
  error: text.nullable(),
  latestImage: captureImage.nullable(),
  cooling: z.object({
    state: z.enum(['on', 'off']),
    canSetTemperature: z.boolean(),
    sensorTemperatureC: z.number().optional(),
    setpointC: z.number().optional(),
    powerPercent: z.number().min(0).max(100).optional(),
  }).nullable(),
})

export function isCaptureView(value: unknown, rigId: string): value is CaptureView {
  const result = captureView.safeParse(value)

  if (!result.success) return false
  const view = result.data

  return view.rigId === rigId
    && view.active === ['exposing', 'reading', 'saving', 'stopping'].includes(view.phase)
    && (!view.active || view.exposureSeconds >= 0.1)
    && (view.latestImage === null || isCaptureImage(view.latestImage, rigId))
}

function isCaptureImage(value: unknown, rigId: string, retained = false): value is CaptureImage {
  const result = captureImage.safeParse(value)

  if (!result.success) return false
  const image = result.data
  // Preview URLs belong to this rig and immutable image ID.
  const expected = retained ? `/api/rigs/${encodeURIComponent(rigId)}/saved-images/${encodeURIComponent(image.id)}/preview` : `/api/rigs/${encodeURIComponent(rigId)}/capture/images/${encodeURIComponent(image.id)}`

  return image.imageUrl === expected
    && (image.fitImageUrl === undefined || image.fitImageUrl === (retained ? expected.replace(/\/preview$/, '/fit') : `${expected}/fit`))
}

const savedImage = captureImage.safeExtend({
  rigId: z.string(),
  saved: z.literal(true),
  savedAt: timestamp,
  fitsUrl: z.string(),
  previewDownloadUrl: z.string(),
})

export function isSavedImage(value: unknown, rigId: string): value is SavedImage {
  const result = savedImage.safeParse(value)

  if (!result.success || result.data.rigId !== rigId || !isCaptureImage(value, rigId, true)) return false
  const expected = `/api/rigs/${encodeURIComponent(rigId)}/saved-images/${encodeURIComponent(result.data.id)}`

  return result.data.fitsUrl === `${expected}/fits` && result.data.previewDownloadUrl === `${expected}/download-preview`
}

const savedImagesView = z.object({ rigId: z.string(), rigName: text, images: z.array(savedImage) })

const savedImageView = z.object({ rigId: z.string(), rigName: text, image: savedImage })

export function isSavedImagesView(value: unknown, rigId: string): value is SavedImagesView {
  const result = savedImagesView.safeParse(value)

  return result.success && result.data.rigId === rigId
    && result.data.images.every(image => isSavedImage(image, rigId))
    && new Set(result.data.images.map(image => image.id)).size === result.data.images.length
}

export function isSavedImageView(value: unknown, rigId: string): value is SavedImageView {
  const result = savedImageView.safeParse(value)

  return result.success && result.data.rigId === rigId && isSavedImage(result.data.image, rigId)
}
