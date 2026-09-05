import type { CaptureImage, CaptureView } from '@vela/model/web'

export function isCaptureView(value: unknown, rigId: string): value is CaptureView {
  if (!record(value) || value.rigId !== rigId || !text(value.rigName)) return false
  if (value.camera !== null && (!record(value.camera) || !text(value.camera.name))) return false
  if (typeof value.enabled !== 'boolean' || !nullableText(value.unavailableReason)) return false
  if (!['idle', 'exposing', 'reading', 'stopping', 'complete', 'stopped', 'failed'].includes(String(value.phase))) return false
  if (value.active !== ['exposing', 'reading', 'stopping'].includes(String(value.phase))) return false
  if (!finite(value.exposureSeconds) || value.exposureSeconds < 0 || value.exposureSeconds > 600) return false
  if (value.active && value.exposureSeconds < 0.1) return false
  if (typeof value.repeat !== 'boolean' || !Number.isSafeInteger(value.completedCount) || Number(value.completedCount) < 0) return false
  return finite(value.elapsedSeconds) && value.elapsedSeconds >= 0 && nullableText(value.error)
    && (value.latestImage === null || isCaptureImage(value.latestImage, rigId))
}

function isCaptureImage(value: unknown, rigId: string): value is CaptureImage {
  if (!record(value) || !text(value.id) || !text(value.cameraName)) return false
  // Preview URLs are same-origin resources belonging to this rig and immutable image ID.
  const expected = `/api/rigs/${encodeURIComponent(rigId)}/capture/images/${encodeURIComponent(value.id)}`
  return value.imageUrl === expected
    && (value.fitImageUrl === undefined || value.fitImageUrl === `${expected}/fit`)
    && (value.color === 'mono' || value.color === 'color')
    && finite(value.width) && Number.isInteger(value.width) && value.width > 0
    && finite(value.height) && Number.isInteger(value.height) && value.height > 0
    && finite(value.exposureSeconds) && value.exposureSeconds >= 0.1 && value.exposureSeconds <= 600
    && isStatistics(value.statistics)
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
