import type { AlertsView } from '@vela/model/web'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { isAlertsView } from './validation'

export type TestOutcome =
  | { state: 'idle' }
  | { state: 'sending' }
  | { state: 'sent' }
  | { state: 'failed'; message: string }

export function useAlerts(rigId: string) {
  const [view, setView] = useState<AlertsView | null>(null)
  const [offline, setOffline] = useState(false)
  const [acknowledging, setAcknowledging] = useState<string | null>(null)
  const [acknowledgeError, setAcknowledgeError] = useState<string | null>(null)
  const [test, setTest] = useState<TestOutcome>({ state: 'idle' })
  const alive = useRef(false)
  const base = `rigs/${encodeURIComponent(rigId)}/alerts`

  const read = useCallback(async () => {
    try {
      const next = await api(`web/${base}`, { signal: AbortSignal.timeout(5000) })

      if (!isAlertsView(next, rigId)) throw new Error('Invalid alerts response')

      if (!alive.current) return
      setView(next)
      setOffline(false)
    } catch {
      if (alive.current) setOffline(true)
    }
  }, [base, rigId])

  useEffect(() => {
    alive.current = true
    let timer: ReturnType<typeof setTimeout>

    async function poll() {
      await read()

      if (alive.current) timer = setTimeout(poll, 1000)
    }

    void poll()

    return () => {
      alive.current = false
      clearTimeout(timer)
    }
  }, [read])

  async function post(path: string) {
    const next = await api(`${base}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(15_000),
    })

    if (!isAlertsView(next, rigId)) throw new Error('Invalid alerts response')

    if (alive.current) setView(next)
  }

  async function acknowledge(id: string) {
    setAcknowledging(id)
    setAcknowledgeError(null)

    try {
      await post(`${encodeURIComponent(id)}/acknowledge`)
    } catch (cause) {
      if (!alive.current) return

      if (cause instanceof ApiError && cause.code === 'alert-not-active') await read()
      else if (cause instanceof ApiError && cause.code === 'phone-cancel-failed')
        setAcknowledgeError(
          `The phone could not be told to stop repeating${cause.reason ? `: ${cause.reason}` : ''}. The alert is not acknowledged.`,
        )
      else
        setAcknowledgeError(
          'Vela could not confirm the acknowledgement. The next update shows whether it took.',
        )
    } finally {
      if (alive.current) setAcknowledging(null)
    }
  }

  async function sendTest() {
    setTest({ state: 'sending' })

    try {
      await post('test')

      if (alive.current) setTest({ state: 'sent' })
    } catch (cause) {
      if (!alive.current) return

      if (cause instanceof ApiError && cause.code === 'phone-alerts-not-configured')
        setTest({ state: 'failed', message: 'Phone alerts are not set up, so nothing was sent.' })
      else if (cause instanceof ApiError && cause.code === 'phone-alerts-failing')
        setTest({
          state: 'failed',
          message: `The test was not sent${cause.reason ? `: ${cause.reason}` : ''}.`,
        })
      else
        setTest({
          state: 'failed',
          message: 'Vela could not confirm the test. Check your phone before sending another.',
        })

      void read()
    }
  }

  return { view, offline, acknowledging, acknowledgeError, test, acknowledge, sendTest }
}

export type AlertsState = ReturnType<typeof useAlerts>
