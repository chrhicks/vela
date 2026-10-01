import { useEffect, useState } from 'react'
import type { CaptureImage } from '@vela/model/web'

type NativeImage = {
  id: string
  url?: string
  state: 'loading' | 'ready' | 'failed' | 'expired'
}

/** One exact-image read. Keep fitted pixels in the viewer until these bytes decode. */
export function useNativeImage(frame: CaptureImage | null, requested: boolean) {
  const [result, setResult] = useState<NativeImage | null>(null)
  const [attempt, setAttempt] = useState(0)
  const id = frame?.id
  const url = frame?.imageUrl

  useEffect(() => {
    if (!requested || !id || !url) {
      setResult(null)

      return
    }

    const controller = new AbortController()
    let objectUrl: string | undefined
    let cancelled = false
    setResult({ id, state: 'loading' })

    async function load() {
      try {
        const response = await fetch(url!, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]),
        })

        if (!response.ok) {
          if (!cancelled) setResult({ id: id!, state: response.status === 404 || response.status === 410 ? 'expired' : 'failed' })

          return
        }

        const blob = await response.blob()

        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        const candidate = new Image()
        candidate.src = objectUrl
        await candidate.decode()

        if (!cancelled) setResult({ id: id!, url: objectUrl, state: 'ready' })
      } catch {
        if (!cancelled) setResult({ id: id!, state: 'failed' })
      }
    }

    void load()

    return () => {
      cancelled = true
      controller.abort()

      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [id, url, requested, attempt])

  return { result: result?.id === id ? result : null, retry: () => setAttempt(value => value + 1) }
}
