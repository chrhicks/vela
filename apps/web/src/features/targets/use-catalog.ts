import type { TargetCatalogView } from '@vela/model/web'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { isTargetCatalog } from './validation'
import type { DiscoverySelection } from './use-discovery'

/** Catalog browsing has no observing site, rig lifecycle, or persistent sky cache. */
export function useCatalog({ query, category, filter, offset }: DiscoverySelection) {
  const [view, setView] = useState<TargetCatalogView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()

    const params = new URLSearchParams({
      q: query,
      category,
      filter,
      offset: String(offset),
      pageSize: '9',
    })

    setLoading(true)
    setError(null)
    void api(`web/target-catalog?${params}`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
    })
      .then((next) => {
        if (!isTargetCatalog(next) || next.pageSize !== 9)
          throw new Error('Invalid catalog response')

        if (!controller.signal.aborted) setView(next)
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError('Could not load the catalog. Retry when the connection returns.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [query, category, filter, offset, revision])
  const refresh = useCallback(() => setRevision((value) => value + 1), [])

  return { view, loading, error, refresh, saved: false }
}
