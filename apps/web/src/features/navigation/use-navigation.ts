import type { NavigationCapture, NavigationView } from '@vela/model/web'
import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { isNavigationView } from './validation'

type State = { view: NavigationView | null; activity: NavigationCapture | null; offline: boolean; missing: boolean }

export function useNavigation() {
  const [state, setState] = useState<State>({ view: null, activity: null, offline: false, missing: false })
  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    let request: AbortController | null = null

    async function poll() {
      request = new AbortController()

      try {
        const view = await api('web/navigation', { signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)]) })

        if (!isNavigationView(view)) throw new Error('Invalid navigation response')

        if (disposed) return
        setState(previous => {
          // Keep following the same run across routes. If another rig is also
          // active, catalog order gives a stable fallback without inventing ownership.
          const active = view.captures.find(capture => capture.active && capture.rigId === previous.activity?.rigId)
            ?? view.captures.find(capture => capture.active)

          if (active) return { view, activity: active, offline: false, missing: false }
          const last = previous.activity
          const confirmed = view.captures.find(capture => capture.rigId === last?.rigId)

          const disappeared = last && (last.active || previous.missing) && (!confirmed || confirmed.phase === 'idle')
            && view.rigs.some(rig => rig.id === last.rigId)

          if (disappeared) return { view, activity: last, offline: false, missing: true }

          return { view, activity: view.captures.find(capture => capture.phase === 'failed') ?? null, offline: false, missing: false }
        })
      } catch {
        if (!disposed) setState(previous => ({ ...previous, offline: true }))
      } finally {
        if (!disposed) timer = setTimeout(poll, 1000)
      }
    }

    void poll()

    return () => {
      disposed = true
      clearTimeout(timer)
      request?.abort()
    }
  }, [])

  return state
}
