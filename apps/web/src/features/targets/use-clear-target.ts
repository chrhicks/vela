import { useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { isCaptureView } from '../capture/validation'

export function useClearTarget(rigId: string, onCleared: () => void) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function clear() {
    setPending(true)
    setError(null)

    try {
      const view = await api(`rigs/${encodeURIComponent(rigId)}/capture/target`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId: null }),
        signal: AbortSignal.timeout(15_000),
      })

      if (!isCaptureView(view, rigId) || view.chosenTarget.state !== 'none')
        throw new Error('Invalid target choice response')

      onCleared()
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.code
          ? cause.code
          : 'Vela could not confirm the target was cleared. Check Tonight before capturing.',
      )
    } finally {
      setPending(false)
    }
  }

  return { clear, pending, error }
}
