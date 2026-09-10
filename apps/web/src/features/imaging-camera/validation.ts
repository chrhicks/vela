import type { ImagingCameraView } from '@vela/model/web'

export function isImagingCameraView(value: unknown, rigId: string): value is ImagingCameraView {
  if (!record(value) || value.rigId !== rigId || typeof value.editable !== 'boolean') return false

  if (!['unselected', 'ready', 'missing', 'changed', 'unavailable'].includes(String(value.state))) return false

  if (value.selected !== null && (!record(value.selected) || !text(value.selected.id) || !text(value.selected.name))) return false

  if (!Array.isArray(value.cameras) || !value.cameras.every(camera => record(camera)
    && text(camera.id) && text(camera.configuredName) && (camera.name === null || text(camera.name)))) return false

  return new Set(value.cameras.map(camera => camera.id)).size === value.cameras.length
}

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }

function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 }
