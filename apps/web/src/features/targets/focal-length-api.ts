import { api, ApiError } from '../../lib/api'
import { isFramingView } from './validation'

export interface FocalLengthSettings {
  rigId: string
  focalLengthMm: number | null
  active: boolean
  observedAt: string
}

export type FocalLengthSaveResult =
  | { status: 'confirmed'; view: FocalLengthSettings }
  | { status: 'rejected' | 'unconfirmed'; error: string }
  | { status: 'unavailable' }

export function isValidFocalLength(value: number) {
  return Number.isFinite(value) && value >= 10 && value <= 20000
}

async function requestSettings(
  path: string,
  rigId: string,
  init: RequestInit,
): Promise<FocalLengthSettings> {
  const value = await api(path, init)

  if (!isFramingView(value, rigId) || Date.now() - Date.parse(value.observedAt) > 15000)
    throw new Error('Invalid or stale focal-length response')

  return {
    rigId: value.rigId,
    focalLengthMm: value.focalLengthMm,
    active: value.active,
    observedAt: value.observedAt,
  }
}

export async function readFocalLengthSettings(rigId: string, signal: AbortSignal) {
  return requestSettings(`web/rigs/${encodeURIComponent(rigId)}/framing`, rigId, { signal })
}

export async function saveFocalLengthSettings(
  rigId: string,
  focalLengthMm: number,
  signal: AbortSignal,
): Promise<FocalLengthSaveResult> {
  if (!isValidFocalLength(focalLengthMm))
    return { status: 'rejected', error: 'Enter a focal length between 10 and 20000 mm.' }

  try {
    const view = await requestSettings(`rigs/${encodeURIComponent(rigId)}/framing/settings`, rigId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ focalLengthMm }),
      signal,
    })

    if (view.focalLengthMm !== focalLengthMm) throw new Error('Unconfirmed focal length')

    return { status: 'confirmed', view }
  } catch (cause) {
    if (cause instanceof ApiError && [400, 404, 409].includes(cause.status))
      return {
        status: 'rejected',
        error: 'The focal length was not saved. Check current rig state before trying again.',
      }

    return {
      status: 'unconfirmed',
      error: 'The save response could not be confirmed. Check the saved focal length before trying again; Vela has not repeated the request.',
    }
  }
}
