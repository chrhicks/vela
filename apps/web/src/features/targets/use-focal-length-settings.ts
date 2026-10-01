import { useCallback, useEffect, useRef, useState } from 'react'
import {
  readFocalLengthSettings,
  saveFocalLengthSettings,
  type FocalLengthSaveResult,
  type FocalLengthSettings,
} from './focal-length-api'

/** Configuration only: never starts an exposure or moves the mount. */
export function useFocalLengthSettings(rigId: string) {
  const [view, setView] = useState<FocalLengthSettings | null>(null)
  const [offline, setOffline] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unconfirmed, setUnconfirmed] = useState(false)
  const request = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const alive = useRef(false)
  const writing = useRef(false)
  const uncertainLength = useRef<number | null>(null)

  const read = useCallback(async (checked = false) => {
    if (!alive.current || writing.current) return

    if (checked) {
      request.current?.abort()
      request.current = null
      generation.current++
    }

    if (request.current) return
    const controller = new AbortController()
    const current = generation.current
    request.current = controller

    try {
      const next = await readFocalLengthSettings(
        rigId,
        AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
      )

      if (!alive.current || generation.current !== current) return
      setView(next)
      setOffline(false)

      if (uncertainLength.current !== null) {
        const confirmed = next.focalLengthMm === uncertainLength.current

        if (confirmed || checked) {
          uncertainLength.current = null
          setUnconfirmed(false)
          setError(confirmed ? null : 'The requested focal length is not saved. Review it and save when ready.')
        }
      }

      return next
    } catch {
      if (alive.current && generation.current === current) setOffline(true)
    } finally {
      if (request.current === controller) request.current = null
    }
  }, [rigId])

  useEffect(() => {
    alive.current = true
    setView(null)
    setOffline(false)
    setPending(false)
    setError(null)
    setUnconfirmed(false)
    uncertainLength.current = null
    let disposed = false
    let timer: ReturnType<typeof setTimeout>

    async function poll() {
      if (!document.hidden) await read()

      if (!disposed) timer = setTimeout(poll, 2000)
    }

    const visible = () => {
      if (!document.hidden) void read()
    }

    document.addEventListener('visibilitychange', visible)
    void poll()

    return () => {
      disposed = true
      alive.current = false
      generation.current++
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', visible)
      request.current?.abort()
      request.current = null
      writing.current = false
    }
  }, [read])

  async function save(focalLengthMm: number): Promise<FocalLengthSaveResult> {
    if (
      !alive.current || writing.current || uncertainLength.current !== null ||
      offline || !view || view.rigId !== rigId || view.active
    ) return { status: 'unavailable' }

    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    const current = ++generation.current
    writing.current = true
    setPending(true)
    setError(null)

    try {
      const result = await saveFocalLengthSettings(
        rigId,
        focalLengthMm,
        AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      )

      if (!alive.current || generation.current !== current) return { status: 'unavailable' }

      if (result.status === 'confirmed') {
        setView(result.view)
        setOffline(false)
      } else if (result.status === 'rejected' || result.status === 'unconfirmed') {
        setError(result.error)

        if (result.status === 'unconfirmed') {
          uncertainLength.current = focalLengthMm
          setUnconfirmed(true)
        }
      }

      return result
    } finally {
      if (request.current === controller) {
        request.current = null
        writing.current = false

        if (alive.current && generation.current === current) {
          setPending(false)
          void read()
        }
      }
    }
  }

  return { view, offline, pending, error, unconfirmed, save, refresh: () => read(true) }
}
