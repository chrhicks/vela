import type { AlertsView } from '@vela/model/web'
import { useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { isAlertsView } from './validation'

export type TestOutcome =
  | { state: 'idle' }
  | { state: 'sending' }
  | { state: 'sent' }
  | { state: 'failed'; message: string }

/** What the browser last learned from one rig's server, and whether the latest check failed. */
type RigAlerts = { view: AlertsView | null; offline: boolean }

/** The one action in flight or just finished; it belongs to the rig that started it. */
type Action = {
  rigId: string
  acknowledging: string | null
  acknowledgeError: string | null
  test: TestOutcome
}

const noView: RigAlerts = { view: null, offline: false }

const idle = (rigId: string): Action => ({ rigId, acknowledging: null, acknowledgeError: null, test: { state: 'idle' } })

const alertsPath = (rigId: string) => `rigs/${encodeURIComponent(rigId)}/alerts`

async function fetchAlerts(rigId: string, signal: AbortSignal) {
  const next = await api(`web/${alertsPath(rigId)}`, { signal })

  if (!isAlertsView(next, rigId)) throw new Error('Invalid alerts response')

  return next
}

/**
 * The only owner of alert state. It outlives navigation, keeps every rig's last view, and polls the
 * rig being followed, one loop per rig even when React sets an effect up twice.
 */
export function useAlerts(rigId: string | undefined) {
  const [rigs, setRigs] = useState<Record<string, RigAlerts>>({})
  const [action, setAction] = useState<Action | null>(null)

  function record(rig: string, next: Partial<RigAlerts>) {
    setRigs(all => ({ ...all, [rig]: { ...(all[rig] ?? noView), ...next } }))
  }

  function act(rig: string, patch: Partial<Action>) {
    setAction(current => ({ ...(current?.rigId === rig ? current : idle(rig)), ...patch }))
  }

  useEffect(() => {
    if (!rigId) return

    const rig = rigId
    const loop = new AbortController()
    let timer: ReturnType<typeof setTimeout>

    async function poll() {
      try {
        const next = await fetchAlerts(rig, AbortSignal.any([loop.signal, AbortSignal.timeout(5000)]))

        if (loop.signal.aborted) return

        record(rig, { view: next, offline: false })
      } catch {
        if (loop.signal.aborted) return

        record(rig, { offline: true })
      }

      timer = setTimeout(poll, 1000)
    }

    // Deferred so a setup React immediately discards never sends a request.
    timer = setTimeout(poll, 0)

    return () => {
      loop.abort()
      clearTimeout(timer)
      // Nobody checks this rig now, so whatever view is kept is no longer current.
      setRigs(all => (all[rig]?.view ? { ...all, [rig]: { ...all[rig], offline: true } } : all))
    }
  }, [rigId])

  const { view, offline } = (rigId && rigs[rigId]) || noView
  const current = action?.rigId === rigId ? action : null

  async function post(rig: string, path: string) {
    const next = await api(`${alertsPath(rig)}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(15_000),
    })

    if (!isAlertsView(next, rig)) throw new Error('Invalid alerts response')

    record(rig, { view: next })
  }

  async function reread(rig: string) {
    try {
      record(rig, { view: await fetchAlerts(rig, AbortSignal.timeout(5000)), offline: false })
    } catch {
      record(rig, { offline: true })
    }
  }

  async function acknowledge(id: string) {
    if (!rigId) return

    act(rigId, { acknowledging: id, acknowledgeError: null })

    try {
      await post(rigId, `${encodeURIComponent(id)}/acknowledge`)
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'alert-not-active') await reread(rigId)
      else if (cause instanceof ApiError && cause.code === 'phone-cancel-failed')
        act(rigId, {
          acknowledgeError: `The phone could not be told to stop repeating${cause.reason ? `: ${cause.reason}` : ''}. The alert is not acknowledged.`,
        })
      else
        act(rigId, {
          acknowledgeError: 'Vela could not confirm the acknowledgement. The next update shows whether it took.',
        })
    } finally {
      act(rigId, { acknowledging: null })
    }
  }

  async function sendTest() {
    if (!rigId) return

    act(rigId, { test: { state: 'sending' } })

    try {
      await post(rigId, 'test')

      act(rigId, { test: { state: 'sent' } })
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'phone-alerts-not-configured')
        act(rigId, { test: { state: 'failed', message: 'Phone alerts are not set up, so nothing was sent.' } })
      else if (cause instanceof ApiError && cause.code === 'phone-alerts-failing')
        act(rigId, {
          test: {
            state: 'failed',
            message: `The test was not sent${cause.reason ? `: ${cause.reason}` : ''}.`,
          },
        })
      else
        act(rigId, {
          test: {
            state: 'failed',
            message: 'Vela could not confirm the test. Check your phone before sending another.',
          },
        })

      void reread(rigId)
    }
  }

  return {
    view,
    offline,
    acknowledging: current?.acknowledging ?? null,
    acknowledgeError: current?.acknowledgeError ?? null,
    test: current?.test ?? ({ state: 'idle' } satisfies TestOutcome),
    acknowledge,
    sendTest,
  }
}

export type AlertsState = ReturnType<typeof useAlerts>
