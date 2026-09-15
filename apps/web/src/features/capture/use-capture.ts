import type { CaptureView } from '@vela/model/web'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { isCaptureView } from './validation'

export function captureActivity(view: CaptureView, offline: boolean) {
  if (offline) return 'Connection interrupted'

  return {
    idle: 'Ready for an exposure', exposing: 'Exposing', reading: 'Receiving image', saving: 'Saving image', stopping: 'Stopping capture',
    complete: 'Image received', stopped: 'Capture stopped', failed: 'Capture stopped · error',
  }[view.phase]
}

export function useCapture(rigId: string) {
  const [view, setView] = useState<CaptureView | null>(null)
  const [offline, setOffline] = useState(false)
  const [pending, setPending] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [commandUnconfirmed, setCommandUnconfirmed] = useState(false)
  const [coolingPending, setCoolingPending] = useState(false)
  const [coolingError, setCoolingError] = useState<string | null>(null)
  const [coolingUnconfirmed, setCoolingUnconfirmed] = useState(false)
  const request = useRef<AbortController | null>(null)
  const lastView = useRef<CaptureView | null>(null)
  const writing = useRef(false)
  const generation = useRef(0)
  const alive = useRef(false)

  const read = useCallback(async (explicit = false) => {
    if (request.current || !alive.current) return
    const controller = new AbortController()
    const current = generation.current
    request.current = controller
    setRefreshing(true)

    try {
      const next = await api(`web/rigs/${encodeURIComponent(rigId)}/capture`, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
      })

      if (!isCaptureView(next, rigId)) throw new Error('Invalid capture response')

      if (!alive.current || current !== generation.current) return
      const interruptedExposure = lastView.current?.active && next.phase === 'idle'
      lastView.current = next
      setView(next)
      setOffline(false)

      if (interruptedExposure) {
        setCommandUnconfirmed(true)
        setError('Vela no longer tracks the exposure that was active. Check capture state before starting another exposure.')
      } else if (explicit && !next.active) {
        setCommandUnconfirmed(false)
        setError(null)
        setCoolingUnconfirmed(false)
        setCoolingError(null)
      }
    } catch (cause) {
      if (!alive.current || current !== generation.current) return
      setOffline(true)

      if (cause instanceof ApiError && cause.status === 404) setError('This Rig is no longer available.')
    } finally {
      if (request.current === controller) {
        request.current = null

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
    }
  }, [read])

  const canStart = !!view?.enabled && !view.active && !offline && !pending && !coolingPending && !commandUnconfirmed
  const canStop = !!view?.active && view.phase !== 'stopping' && !offline && !pending
  const canCool = !!view?.cooling && !view.active && !offline && !pending && !coolingPending && !coolingUnconfirmed && !commandUnconfirmed

  async function post(
    path: 'start' | 'stop' | 'cooling',
    body: { exposureSeconds: number, repeat: boolean, saveFrames: boolean } | { coolerOn: boolean } | { setpointC: number } | Record<string, never>,
  ) {
    if (writing.current || !alive.current) return

    let allowed = canCool

    if (path === 'start') allowed = canStart

    if (path === 'stop') allowed = canStop

    if (!allowed) return

    const controller = new AbortController()
    // A deliberate command supersedes a quiet poll. Its late result cannot
    // overwrite the command response, even if transport cancellation loses a race.
    request.current?.abort()
    request.current = controller
    const current = ++generation.current
    writing.current = true
    setRefreshing(false)

    if (path === 'cooling') {
      setCoolingPending(true)
      setCoolingError(null)
    } else {
      setPending(true)
      setError(null)
    }

    try {
      const next = await api(`rigs/${encodeURIComponent(rigId)}/capture/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      })

      if (!isCaptureView(next, rigId)) throw new Error('Invalid capture response')

      if (!alive.current || current !== generation.current) return
      lastView.current = next
      setView(next)
      setOffline(false)
      setCommandUnconfirmed(false)
      setError(null)
      setCoolingUnconfirmed(false)
      setCoolingError(null)
    } catch (cause) {
      if (!alive.current || current !== generation.current) return

      if (path === 'cooling') {
        const message = cause instanceof ApiError && cause.code
          ? cause.code
          : 'The cooler command could not be confirmed. Check camera cooling before assuming it changed.'

        setCoolingError(message)
        setCoolingUnconfirmed(/could not be confirmed/i.test(message))

        return
      }

      setCommandUnconfirmed(true)
      setError('The command response could not be confirmed. Check capture state before starting another exposure.')
    } finally {
      if (request.current === controller) {
        request.current = null
        writing.current = false

        if (alive.current && current === generation.current) {
          if (path === 'cooling') setCoolingPending(false)
          else setPending(false)
        }
      }
    }
  }

  return { view, offline, pending, coolingPending, refreshing, error, coolingError, commandUnconfirmed, coolingUnconfirmed, canStart, canStop, canCool,
    start: (seconds: number, repeat: boolean, saveFrames: boolean) => {
      if (!Number.isFinite(seconds) || seconds < 0.1 || seconds > 600) return Promise.resolve()

      return post('start', { exposureSeconds: seconds, repeat, saveFrames })
    },
    stop: () => post('stop', {}),
    setCooler: (coolerOn: boolean) => post('cooling', { coolerOn }),
    setCoolingTemperature: (setpointC: number) => post('cooling', { setpointC }),
    refresh: () => read(true) }
}
