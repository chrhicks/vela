import { useEffect, useState } from 'react'
import { pixelIdentity, type ImagePixels } from './image-pixels'

type NativeImage = {
  identity: string
  url?: string
  state: 'loading' | 'ready' | 'failed' | 'missing'
}

/** One exact-image read. Keep fitted pixels in the viewer until these bytes decode. */
export function useNativeImage(frame: ImagePixels | null, requested: boolean) {
  const [result, setResult] = useState<NativeImage | null>(null)
  const [attempt, setAttempt] = useState(0)
  const identity = frame ? pixelIdentity(frame) : undefined
  const url = frame?.imageUrl

  useEffect(() => {
    if (!requested || !identity || !url) {
      setResult(null)

      return
    }

    const controller = new AbortController()
    let objectUrl: string | undefined
    let cancelled = false
    setResult({ identity, state: 'loading' })

    async function load() {
      try {
        const response = await fetch(url!, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]),
        })

        if (!response.ok) {
          if (!cancelled) setResult({ identity: identity!, state: response.status === 404 || response.status === 410 ? 'missing' : 'failed' })

          return
        }

        const blob = await response.blob()

        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        const candidate = new Image()
        candidate.src = objectUrl
        await candidate.decode()

        if (!cancelled) setResult({ identity: identity!, url: objectUrl, state: 'ready' })
      } catch {
        if (!cancelled) setResult({ identity: identity!, state: 'failed' })
      }
    }

    void load()

    return () => {
      cancelled = true
      controller.abort()

      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [identity, url, requested, attempt])

  return { result: result?.identity === identity ? result : null, retry: () => setAttempt(value => value + 1) }
}
