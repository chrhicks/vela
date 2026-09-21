import type { AutofocusView } from '@vela/model/web'
import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { isAutofocusView, isTravelLimitError } from './validation'

export function autofocusActivity(view: AutofocusView, offline: boolean) {
  if (offline) return 'Connection interrupted'

  if (view.captureReadState === 'retrying') return 'Camera observation interrupted'

  if (view.activity === 'moving') return 'Moving to the next sample…'

  if (view.activity === 'exposing') return `Exposing at ${view.currentPosition ?? 'this stop'}…`

  if (view.activity === 'measuring') return 'Measuring star HFR…'

  if (view.activity === 'fitting') return 'Fitting the hyperbola…'

  if (view.activity === 'restoring') return `Restoring start ${view.startPosition ?? ''}…`

  if (view.activity === 'stopping') return 'Stopping…'

  if (view.phase === 'complete') return 'Fitted focus is ready'

  if (view.phase === 'stopped') return 'Walk stopped · start restored'

  if (view.phase === 'setup' && view.error) return 'Walk did not start'

  if (view.phase === 'failed') {
    if (isTravelLimitError(view.error)) return 'Walk did not start'

    if (view.restoredStart) return 'Walk failed · start restored'

    return 'Walk failed · start was not restored'
  }

  return 'Ready to start from the current position'
}

export function useAutofocus(rigId: string) {
  const [view, setView] = useState<AutofocusView | null>(null)
  const [offline, setOffline] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const writing = useRef(false)
  const alive = useRef(false)

  async function read() {
    const current = generation.current

    try {
      const next = await api(`web/rigs/${encodeURIComponent(rigId)}/autofocus`, { signal: AbortSignal.timeout(5000) })

      if (!isAutofocusView(next, rigId)) throw new Error('Invalid autofocus response')

      if (alive.current && current === generation.current) { setView(next); setOffline(false) }
    } catch {
      if (alive.current && current === generation.current) setOffline(true)
    }
  }

  useEffect(() => {
    alive.current = true
    let disposed = false
    let timer: ReturnType<typeof setTimeout>

    async function poll() {
      if (!writing.current) await read()

      if (!disposed) timer = setTimeout(poll, 500)
    }

    void poll()

    return () => { disposed = true; alive.current = false; generation.current++; clearTimeout(timer) }
  }, [rigId])

  async function command(action: 'start' | 'stop', body: Record<string, number> = {}) {
    if (writing.current || offline) return
    writing.current = true
    generation.current++
    setPending(true)
    setError(null)

    try {
      const result = await api(`rigs/${encodeURIComponent(rigId)}/autofocus/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'start' ? body : {}),
        signal: AbortSignal.timeout(15000),
      })

      if (!isAutofocusView(result, rigId)) throw new Error('Invalid autofocus response')

      if (alive.current) { setView(result); setOffline(false) }
    } catch (cause) {
      const message = cause instanceof ApiError && cause.code
        ? cause.code
        : cause instanceof Error ? cause.message : 'Command response unavailable'

      if (alive.current) setError(`${message}. The command was not repeated; check the current state before trying again.`)
      await read()
    } finally {
      writing.current = false

      if (alive.current) setPending(false)
    }
  }

  return { view, offline, pending, error, start: (stepSize: number, exposureSeconds: number) => command('start', { stepSize, exposureSeconds }), stop: () => command('stop') }
}
