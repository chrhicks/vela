import { useState } from 'react'
import { useNavigate } from 'react-router'
import { api, ApiError } from '../../lib/api'
import { isCaptureView } from '../capture/validation'

export function useChooseTarget(rigId: string) {
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function choose(targetId: string) {
    setPending(true)
    setError(null)

    try {
      const view = await api(`rigs/${encodeURIComponent(rigId)}/capture/target`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId }),
        signal: AbortSignal.timeout(15_000),
      })

      if (
        !isCaptureView(view, rigId) ||
        view.chosenTarget.state !== 'chosen' ||
        view.chosenTarget.subject.targetId !== targetId
      )
        throw new Error('Invalid target choice response')

      void navigate(`/rigs/${encodeURIComponent(rigId)}/observe/capture`)
    } catch (cause) {
      setPending(false)
      setError(
        cause instanceof ApiError && cause.code
          ? cause.code
          : 'Vela could not confirm this target choice. Try again.',
      )
    }
  }

  return { choose, pending, error }
}
