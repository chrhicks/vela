import type { ImagingCameraView } from '@vela/model/web'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { isImagingCameraView } from './validation'

type Choice = NonNullable<ImagingCameraView['selected']>

export function useImagingCamera(rigId: string) {
  const [view, setView] = useState<ImagingCameraView | null>(null)
  const [offline, setOffline] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unconfirmed, setUnconfirmed] = useState(false)
  const [confirmedSaves, setConfirmedSaves] = useState(0)
  const request = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const alive = useRef(false)
  const writing = useRef(false)
  const uncertainChoice = useRef<Choice | null>(null)

  function accept(next: ImagingCameraView, checked = false) {
    setView(next)
    setOffline(false)
    const choice = uncertainChoice.current

    if (choice && next.selected?.id === choice.id && next.selected.name === choice.name) {
      uncertainChoice.current = null
      setUnconfirmed(false)
      setError(null)
      setConfirmedSaves(count => count + 1)
    } else if (choice && checked && next.editable) {
      uncertainChoice.current = null
      setUnconfirmed(false)
      setError('The requested camera is not the saved selection. The rig is available; choose a camera and save when ready.')
    }
  }

  const read = useCallback(async (checked = false) => {
    if (checked && !writing.current) {
      request.current?.abort()
      request.current = null
      generation.current++
    }

    if (!alive.current || request.current) return
    const controller = new AbortController()
    const current = generation.current
    request.current = controller

    try {
      const next = await api(`web/rigs/${encodeURIComponent(rigId)}/imaging-camera`, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
      })

      if (!isImagingCameraView(next, rigId)) throw new Error('Invalid camera response')

      if (alive.current && generation.current === current) accept(next, checked)
    } catch {
      if (alive.current && generation.current === current) setOffline(true)
    } finally {
      if (request.current === controller) request.current = null
    }
  }, [rigId])

  useEffect(() => {
    alive.current = true
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

  async function save(choice: Choice) {
    if (!alive.current || writing.current || uncertainChoice.current || offline || !view?.editable) return

    if (!view.cameras.some(camera => camera.id === choice.id && camera.name === choice.name)) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    const current = ++generation.current
    writing.current = true
    setPending(true)
    setError(null)

    try {
      const next = await api(`rigs/${encodeURIComponent(rigId)}/imaging-camera`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(choice),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      })

      if (!isImagingCameraView(next, rigId) || next.selected?.id !== choice.id || next.selected.name !== choice.name)
        throw new Error('Unconfirmed selection')

      if (!alive.current || generation.current !== current) return
      accept(next)
      setConfirmedSaves(count => count + 1)
    } catch (cause) {
      if (!alive.current || generation.current !== current) return

      if (cause instanceof ApiError && [400, 404, 409].includes(cause.status)) {
        setError('The camera choice was not saved. Check current camera state and select it again.')
      } else {
        uncertainChoice.current = choice
        setUnconfirmed(true)
        setError('The save response could not be confirmed. Checking the saved camera; Vela has not repeated the request.')
      }
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

  return {
    view,
    offline,
    pending,
    error,
    unconfirmed,
    confirmedSaves,
    save,
    refresh: () => read(true),
  }
}
