import type { TargetCategory, TargetDiscoveryView, TargetFilterChoice } from '@vela/model/web'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { isTargetDiscovery } from './validation'

export interface DiscoverySelection {
  query: string
  category: TargetCategory | 'all'
  filter: TargetFilterChoice | 'all'
  offset: number
}
const key = (rigId: string) => `vela:target-discovery:v1:${rigId}`
export function savedDiscovery(rigId: string): TargetDiscoveryView | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key(rigId)) ?? 'null')
    return isTargetDiscovery(value, rigId) ? value : null
  } catch {
    return null
  }
}
export function selectionOf(view: TargetDiscoveryView): DiscoverySelection {
  return { query: view.query, category: view.category, filter: view.filter, offset: view.offset }
}

/** The saved page paints immediately. No timer replaces a browsing calculation. */
export function useDiscovery(rigId: string, selection: DiscoverySelection) {
  const [view, setView] = useState(() => savedDiscovery(rigId))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(!!view)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const snapshot = useRef(view?.snapshotId)
  const current = useRef(view)
  const requestVersion = useRef(0)
  const needsRefresh = useRef(false)
  const { query, category, filter, offset } = selection
  useEffect(() => {
    const refreshed = needsRefresh.current
    const existing = current.current
    if (!refreshed && existing && existing.query === query && existing.category === category && existing.filter === filter && existing.offset === offset) {
      setLoading(false)
      setError(null)
      return
    }
    const controller = new AbortController()
    const version = ++requestVersion.current
    const params = new URLSearchParams({ q: query, category, filter, offset: String(offset) })
    if (!refreshed && snapshot.current) params.set('snapshot', snapshot.current)
    setLoading(true)
    setError(null)
    void api<unknown>(`web/rigs/${encodeURIComponent(rigId)}/target-discovery?${params}`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
    }).then(next => {
      if (!isTargetDiscovery(next, rigId)) throw new Error('Invalid discovery response')
      if (controller.signal.aborted || version !== requestVersion.current) return
      snapshot.current = next.snapshotId
      needsRefresh.current = false
      current.current = next
      setView(next)
      setSaved(false)
      try { localStorage.setItem(key(rigId), JSON.stringify(next)) } catch { /* Browsing remains available when storage is full or disabled. */ }
    }).catch(cause => {
      if (controller.signal.aborted || version !== requestVersion.current) return
      setError(cause instanceof ApiError && cause.status === 410
        ? 'This saved calculation is no longer available on the server. Refresh to calculate from now.'
        : current.current
          ? 'Could not load these targets. Your last result is still here; try Refresh when the connection returns.'
          : 'Could not load targets. Try Refresh when the connection returns.')
    }).finally(() => {
      if (!controller.signal.aborted && version === requestVersion.current) setLoading(false)
    })
    return () => controller.abort()
  }, [rigId, query, category, filter, offset, refreshVersion])
  const refresh = useCallback(() => {
    needsRefresh.current = true
    setRefreshVersion(value => value + 1)
  }, [])
  return { view, loading, error, saved, refresh }
}
