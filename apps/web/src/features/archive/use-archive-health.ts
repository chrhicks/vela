import type { ArchiveHealthView } from '@vela/model/web'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { isArchiveHealthView } from './validation'

/** The server reuses one health read for a few seconds, so slower polling loses nothing. */
const POLL_MS = 10_000

/**
 * Archive health for one rig. Keeps the last good view during interruptions and records when
 * reads stopped, so the page can mark its age. Reconcile is the only command, and the server
 * treats it as a rescan that never starts an exposure.
 */
export function useArchiveHealth(rigId: string) {
  const [view, setView] = useState<ArchiveHealthView | null>(null)
  const [interruptedAt, setInterruptedAt] = useState<number | null>(null)
  const [reconciling, setReconciling] = useState(false)
  const [reconcileFailed, setReconcileFailed] = useState(false)
  const alive = useRef(false)
  const request = useRef<AbortController | null>(null)

  const accept = useCallback(
    (next: Awaited<ReturnType<typeof api>>) => {
      if (!isArchiveHealthView(next, rigId)) throw new Error('Invalid archive health response')
      setView(next)
      setInterruptedAt(null)
    },
    [rigId],
  )

  const read = useCallback(async () => {
    if (!alive.current || request.current) return

    const controller = new AbortController()
    request.current = controller

    try {
      const next = await api(`web/rigs/${encodeURIComponent(rigId)}/archive`, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
      })

      if (alive.current) accept(next)
    } catch {
      if (alive.current && !controller.signal.aborted) setInterruptedAt(current => current ?? Date.now())
    } finally {
      if (request.current === controller) request.current = null
    }
  }, [accept, rigId])

  useEffect(() => {
    alive.current = true
    let timer: ReturnType<typeof setTimeout>

    async function poll() {
      if (document.visibilityState === 'visible') await read()

      if (alive.current) timer = setTimeout(poll, POLL_MS)
    }

    void poll()

    return () => {
      alive.current = false
      clearTimeout(timer)
      request.current?.abort()
      request.current = null
    }
  }, [read])

  const reconcile = useCallback(async () => {
    setReconciling(true)
    setReconcileFailed(false)

    try {
      accept(await api(`rigs/${encodeURIComponent(rigId)}/archive/reconcile`, { method: 'POST' }))
    } catch {
      // A missing response is never replayed; the next read shows what happened.
      setReconcileFailed(true)
      void read()
    } finally {
      if (alive.current) setReconciling(false)
    }
  }, [accept, read, rigId])

  return { view, interruptedAt, reconciling, reconcileFailed, reconcile }
}
