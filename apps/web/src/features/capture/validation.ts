import type { CaptureImage, CaptureView, SavedImage, SavedImagesView, SavedImageView } from '@vela/model/web'

export function isCaptureView(value: unknown, rigId: string): value is CaptureView {
  if (!record(value) || value.rigId !== rigId || !text(value.rigName)) return false
  if (value.camera !== null && (!record(value.camera) || !text(value.camera.name))) return false
  if (typeof value.enabled !== 'boolean' || !nullableText(value.unavailableReason)) return false
  if (!['idle', 'exposing', 'reading', 'saving', 'stopping', 'complete', 'stopped', 'failed'].includes(String(value.phase))) return false
  if (value.active !== ['exposing', 'reading', 'saving', 'stopping'].includes(String(value.phase))) return false
  if (!finite(value.exposureSeconds) || value.exposureSeconds < 0 || value.exposureSeconds > 600) return false
  if (value.active && value.exposureSeconds < 0.1) return false
  if (typeof value.repeat !== 'boolean' || !Number.isSafeInteger(value.completedCount) || Number(value.completedCount) < 0) return false
  if (typeof value.saveFrames !== 'boolean' || (value.savedImageCount !== null && (!Number.isSafeInteger(value.savedImageCount) || Number(value.savedImageCount) < 0))) return false
  return finite(value.elapsedSeconds) && value.elapsedSeconds >= 0 && nullableText(value.error)
    && (value.latestImage === null || isCaptureImage(value.latestImage, rigId))
}

function isCaptureImage(value: unknown, rigId: string, retained = false): value is CaptureImage {
  if (!record(value) || !text(value.id) || !text(value.cameraName)) return false
  // Preview URLs are same-origin resources belonging to this rig and immutable image ID.
  const expected = retained ? `/api/rigs/${encodeURIComponent(rigId)}/saved-images/${encodeURIComponent(value.id)}/preview` : `/api/rigs/${encodeURIComponent(rigId)}/capture/images/${encodeURIComponent(value.id)}`
  return typeof value.saved === 'boolean' && value.imageUrl === expected
    && (value.fitImageUrl === undefined || value.fitImageUrl === (retained ? expected.replace(/\/preview$/, '/fit') : `${expected}/fit`))
    && (value.color === 'mono' || value.color === 'color')
    && finite(value.width) && Number.isInteger(value.width) && value.width > 0
    && finite(value.height) && Number.isInteger(value.height) && value.height > 0
    && finite(value.exposureSeconds) && value.exposureSeconds >= 0.1 && value.exposureSeconds <= 600
    && isStatistics(value.statistics)
    && (value.capturedAtSource === undefined || value.capturedAtSource === 'camera' || value.capturedAtSource === 'server-estimate')
    && timestamp(value.capturedAt) && timestamp(value.receivedAt)
    && Date.parse(value.receivedAt) >= Date.parse(value.capturedAt)
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 }
function nullableText(value: unknown) { return value === null || text(value) }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function timestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.+Z$/.test(value) && Number.isFinite(Date.parse(value))
}

function isStatistics(value: unknown): boolean {
  if (value === null) return true
  if (!record(value) || !Number.isSafeInteger(value.detectedStars) || Number(value.detectedStars) < 0) return false
  return value.detectedStars === 0 ? value.medianHfrPixels === null
    : finite(value.medianHfrPixels) && value.medianHfrPixels > 0
}

export function isSavedImage(value: unknown, rigId: string): value is SavedImage {
  if (!record(value) || !isCaptureImage(value, rigId, true) || value.rigId !== rigId || value.saved !== true || !timestamp(value.savedAt)) return false
  const expected = `/api/rigs/${encodeURIComponent(rigId)}/saved-images/${encodeURIComponent(value.id)}`
  return value.fitsUrl === `${expected}/fits` && value.previewDownloadUrl === `${expected}/download-preview`
}

export function isSavedImagesView(value: unknown, rigId: string): value is SavedImagesView {
  return record(value) && value.rigId === rigId && text(value.rigName) && Array.isArray(value.images)
    && value.images.every(image => isSavedImage(image, rigId))
    && new Set(value.images.map(image => image.id)).size === value.images.length
}

export function isSavedImageView(value: unknown, rigId: string): value is SavedImageView {
  return record(value) && value.rigId === rigId && text(value.rigName) && isSavedImage(value.image, rigId)
}
