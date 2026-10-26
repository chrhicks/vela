import { ApiError, api } from '../../lib/api'

export type ClearHoldResult =
  | { readonly kind: 'cleared' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'failed'; readonly message: string }

export async function clearHold(rigId: string, deviceId: string, now = new Date()): Promise<ClearHoldResult> {
  try {
    await api(`rigs/${encodeURIComponent(rigId)}/devices/${encodeURIComponent(deviceId)}/recover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        externalRecoveryConfirmed: true,
        note: `Cleared from the Vela page by the operator at ${now.toISOString()}`,
      }),
      signal: AbortSignal.timeout(30_000),
    })

    return { kind: 'cleared' }
  } catch (error) {
    if (!(error instanceof ApiError))
      return { kind: 'failed', message: 'Vela did not hear back, so the hold may or may not be cleared. The page shows which.' }

    if (error.code === 'device-busy') return { kind: 'busy' }

    return { kind: 'failed', message: error.reason ?? `Vela could not clear the hold. ${error.message}.` }
  }
}
