import { z } from 'zod'
import type {
  CaptureImage,
  CaptureView,
  SavedImage,
  SavedImagesView,
  SavedImageView,
} from '@vela/model/web'
import { frameTypes } from './frame-types'
import { starStatistics } from './star-statistics'

/** The server's limit on `frameCount`. */
export const MAX_FRAME_COUNT = 10_000

export interface FrameCountInput {
  valid: boolean
  frameCount?: number
}

/** Reads the Frames field: blank means repeat until stopped; anything else must be a whole number in range. */
export function parseFrameCount(input: string): FrameCountInput {
  const trimmed = input.trim()

  if (trimmed === '') return { valid: true }
  const count = Number(trimmed)

  if (!Number.isInteger(count) || count < 1 || count > MAX_FRAME_COUNT) return { valid: false }

  return { valid: true, frameCount: count }
}

const text = z.string().refine(value => value.trim().length > 0)

const subject = z.object({ targetId: text, name: text, catalog: text })

const timestamp = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T.+Z$/)
  .refine(value => Number.isFinite(Date.parse(value)))

const captureImage = z
  .object({
    id: text,
    frameType: z.enum(frameTypes),
    subject: subject.nullable().optional(),
    cameraName: text,
    saved: z.boolean(),
    imageUrl: z.string(),
    fitImageUrl: z.string().optional(),
    color: z.enum(['mono', 'color']),
    width: z.number().refine(Number.isInteger).positive(),
    height: z.number().refine(Number.isInteger).positive(),
    exposureSeconds: z.number().min(0.1).max(600),
    statistics: starStatistics.nullable(),
    capturedAtSource: z.enum(['camera', 'server-estimate']).optional(),
    capturedAt: timestamp,
    receivedAt: timestamp,
  })
  .refine(value => Date.parse(value.receivedAt) >= Date.parse(value.capturedAt))

const captureView = z.object({
  rigId: z.string(),
  rigName: text,
  camera: z.object({ name: text }).nullable(),
  enabled: z.boolean(),
  unavailableReason: text.nullable(),
  phase: z.enum([
    'idle',
    'exposing',
    'reading',
    'saving',
    'stopping',
    'complete',
    'stopped',
    'failed',
    'interrupted',
  ]),
  active: z.boolean(),
  captureReadState: z.enum(['current', 'retrying']),
  exposureSeconds: z.number().min(0).max(600),
  repeat: z.boolean(),
  frameType: z.enum(frameTypes),
  frameCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  subject: subject.nullable(),
  unattended: z.boolean(),
  savedCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  integrationSeconds: z.number().finite().nonnegative(),
  completedCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  lostFrameCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  saveFrames: z.boolean(),
  savedImageCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  elapsedSeconds: z.number().nonnegative(),
  error: text.nullable(),
  interruption: z
    .strictObject({
      reason: text,
      remainingCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
    })
    .nullable()
    .optional(),
  latestImage: captureImage.nullable(),
  cooling: z
    .object({
      state: z.enum(['on', 'off']),
      canSetTemperature: z.boolean(),
      sensorTemperatureC: z.number().optional(),
      setpointC: z.number().optional(),
      powerPercent: z.number().min(0).max(100).optional(),
      blockedBy: z
        .union([
          z.enum(['capture', 'alignment', 'autofocus', 'framing', 'rig']),
          z.strictObject({ kind: z.literal('hold'), reason: text }),
        ])
        .optional(),
    })
    .nullable(),
})

export function isCaptureView(value: unknown, rigId: string): value is CaptureView {
  const result = captureView.safeParse(value)

  if (!result.success) return false
  const view = result.data

  return (
    view.rigId === rigId &&
    view.active === ['exposing', 'reading', 'saving', 'stopping'].includes(view.phase) &&
    (view.phase === 'interrupted') === !!view.interruption &&
    (!view.active || view.exposureSeconds >= 0.1) &&
    (view.latestImage === null || isCaptureImage(view.latestImage, rigId))
  )
}

function isCaptureImage(value: unknown, rigId: string): value is CaptureImage {
  const result = captureImage.safeParse(value)

  if (!result.success) return false
  const image = result.data
  // Preview URLs belong to this rig and immutable image ID.
  const expected = `/api/rigs/${encodeURIComponent(rigId)}/capture/images/${encodeURIComponent(image.id)}`

  return (
    image.imageUrl === expected &&
    (image.fitImageUrl === undefined || image.fitImageUrl === `${expected}/fit`)
  )
}

const savedImage = captureImage.safeExtend({
  rigId: z.string(),
  saved: z.literal(true),
  savedAt: timestamp,
  fitsUrl: z.string(),
  previewDownloadUrl: z.string(),
  previewRendering: z
    .discriminatedUnion('status', [
      z.object({ status: z.literal('current'), version: z.literal('background-v1') }),
      z.object({ status: z.literal('legacy') }),
      z.object({ status: z.literal('unavailable') }),
    ])
    .optional(),
})

export function isSavedImage(value: unknown, rigId: string): value is SavedImage {
  const result = savedImage.safeParse(value)

  if (!result.success || result.data.rigId !== rigId) return false
  const expected = `/api/rigs/${encodeURIComponent(rigId)}/saved-images/${encodeURIComponent(result.data.id)}`
  const rendering = result.data.previewRendering

  const preview =
    rendering?.status === 'current' ? `${expected}/previews/${rendering.version}` : expected

  return (
    result.data.fitsUrl === `${expected}/fits` &&
    result.data.previewDownloadUrl === `${preview}/download-preview` &&
    result.data.imageUrl === `${preview}/preview` &&
    (result.data.fitImageUrl === undefined || result.data.fitImageUrl === `${preview}/fit`)
  )
}

const timeZone = text.refine(value => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })

    return true
  } catch {
    return false
  }
})

const savedImagesView = z.object({
  timeZone,
  rigId: z.string(),
  rigName: text,
  images: z.array(savedImage),
})

const savedImageView = z.object({
  timeZone,
  rigId: z.string(),
  rigName: text,
  image: savedImage,
})

export function isSavedImagesView(value: unknown, rigId: string): value is SavedImagesView {
  const result = savedImagesView.safeParse(value)

  return (
    result.success &&
    result.data.rigId === rigId &&
    result.data.images.every(image => isSavedImage(image, rigId)) &&
    new Set(result.data.images.map(image => image.id)).size === result.data.images.length
  )
}

export function isSavedImageView(value: unknown, rigId: string): value is SavedImageView {
  const result = savedImageView.safeParse(value)

  return result.success && result.data.rigId === rigId && isSavedImage(result.data.image, rigId)
}
