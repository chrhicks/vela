import type { FramingView } from '@vela/model/web'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { isFramingView } from './validation'

export function useFraming(rigId: string) {
  const [view, setView] = useState<FramingView | null>(null)
  const [offline, setOffline] = useState(false)
  const [pending, setPending] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [commandUnconfirmed, setCommandUnconfirmed] = useState(false)
  const request = useRef<AbortController | null>(null)
  const lastView = useRef<FramingView | null>(null)
  const writing = useRef(false)
  const explicitRead = useRef(false)
  const generation = useRef(0)
  const alive = useRef(false)

  const read = useCallback(async (explicit = false) => {
    if (!alive.current || writing.current || explicitRead.current || (request.current && !explicit)) return

    // A deliberate check supersedes a quiet poll without exposing polling as
    // button activity or allowing the cancelled response to overwrite it.
    if (request.current) {
      request.current.abort()
      generation.current++
    }

    const controller = new AbortController()
    const current = generation.current
    request.current = controller
    explicitRead.current = explicit
    setRefreshing(explicit)

    try {
      const next = await api(`web/rigs/${encodeURIComponent(rigId)}/framing`, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
      })

      if (!isFramingView(next, rigId) || Date.now() - Date.parse(next.observedAt) > 15000) throw new Error('Invalid or stale framing response')

      if (!alive.current || current !== generation.current) return
      const interruptedExposure = lastView.current?.active && next.phase === 'idle'
      const newlyFailed = next.phase === 'failed' && lastView.current?.phase !== 'failed'
      lastView.current = next
      setView(next)
      setOffline(false)

      if (interruptedExposure) {
        setCommandUnconfirmed(true)
        setError('Vela no longer tracks the exposure that was active. Check framing state before starting another exposure.')
      } else if (newlyFailed && !explicit) {
        setCommandUnconfirmed(true)
        setError('The framing check failed. Inspect the reported state, then check rig state before another command.')
      } else if (explicit) {
        setCommandUnconfirmed(false)
        setError(null)
      }

      return next
    } catch (cause) {
      if (!alive.current || current !== generation.current) return
      setOffline(true)

      if (cause instanceof ApiError && cause.status === 404) setError('This Rig is no longer available.')
    } finally {
      if (request.current === controller) {
        request.current = null
        explicitRead.current = false

        if (alive.current && current === generation.current) setRefreshing(false)
      }
    }
  }, [rigId])

  useEffect(() => {
    alive.current = true
    let disposed = false
    let timer: ReturnType<typeof setTimeout>

    async function poll() {
      await read()

      if (!disposed) timer = setTimeout(poll, 1000)
    }

    void poll()

    return () => {
      disposed = true
      alive.current = false
      generation.current++
      clearTimeout(timer)
      request.current?.abort()
      request.current = null
      writing.current = false
      explicitRead.current = false
    }
  }, [read])

  const canStart = !!view?.enabled && !view.active && !offline && !pending && !commandUnconfirmed
  const canStop = !!view?.active && view.phase !== 'stopping' && !offline && !pending && !commandUnconfirmed

  async function command(action: 'start' | 'stop' | 'center' | 'settings', body: { targetId?: string; raDegrees?: number; decDegrees?: number; exposureSeconds?: number; checkId?: string; focalLengthMm?: number } = {}) {
    const allowed = {
      stop: canStop,
      center: canStart && !!view?.canCenter && !!view.actual,
      settings: !!view && !pending && !offline && !view.active && !commandUnconfirmed,
      start: canStart,
    }[action]

    if (writing.current || !alive.current || !allowed) return
    const controller = new AbortController()
    // A deliberate command supersedes a quiet poll. Its late result cannot
    // overwrite the command response, even if transport cancellation loses a race.
    request.current?.abort()
    request.current = controller
    const current = ++generation.current
    writing.current = true
    explicitRead.current = false
    setRefreshing(false)
    setPending(true)
    setError(null)

    try {
      const next = await api(`rigs/${encodeURIComponent(rigId)}/framing/${action}`, {
        method: action === 'settings' ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      })

      if (!isFramingView(next, rigId) || Date.now() - Date.parse(next.observedAt) > 15000) throw new Error('Invalid or stale framing response')

      if (!alive.current || current !== generation.current) return
      lastView.current = next
      setView(next)
      setOffline(false)

      if (next.phase === 'failed') {
        setCommandUnconfirmed(true)
        setError('The framing check failed. Inspect the reported state, then check rig state before another command.')
      }

      return next
    } catch (cause) {
      if (!alive.current || current !== generation.current) return
      setCommandUnconfirmed(true)
      const detail = cause instanceof ApiError && cause.code ? `${cause.code} ` : ''
      setError(`${detail}The command response could not be confirmed. Check framing state before starting another exposure.`)
    } finally {
      if (request.current === controller) {
        request.current = null
        writing.current = false

        if (alive.current && current === generation.current) setPending(false)
      }
    }
  }

  return { view, offline, pending, refreshing, error, commandUnconfirmed, canStart, canStop,
    start: ({ targetId, raDegrees, decDegrees, exposureSeconds }: { targetId: string, raDegrees: number, decDegrees: number, exposureSeconds: number }) =>
      command('start', { targetId, raDegrees, decDegrees, exposureSeconds }),
    center: () => command('center', { checkId: view?.actual?.checkId }), settings: (focalLengthMm: number) => command('settings', { focalLengthMm }), stop: () => command('stop'), refresh: () => read(true) }
}
