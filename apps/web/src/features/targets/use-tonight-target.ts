import type { TargetView } from '@vela/model/web'
import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { isTarget } from './validation'

/** Refresh sky calculations without replacing the selected observing intent. */
export function useTonightTarget(rigId: string, targetId: string | undefined) {
  const [result, setResult] = useState<{ target: TargetView | null; stale: boolean }>({
    target: null,
    stale: false,
  })

  useEffect(() => {
    setResult({ target: null, stale: false })

    if (!targetId) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>

    async function read() {
      try {
        const target = await api(
          `web/rigs/${encodeURIComponent(rigId)}/targets/${encodeURIComponent(targetId!)}`,
          { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) },
        )

        if (!isTarget(target) || target.id !== targetId)
          throw new Error('Invalid target response')

        if (!controller.signal.aborted) setResult({ target, stale: false })
      } catch {
        if (!controller.signal.aborted) setResult((current) => ({ ...current, stale: true }))
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(read, 60000)
      }
    }

    void read()

    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [rigId, targetId])

  // Never show the preceding target while the effect for a new choice starts.
  return { target: result.target?.id === targetId ? result.target : null, stale: result.stale }
}
