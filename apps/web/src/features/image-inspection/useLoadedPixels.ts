import { useEffect, useRef, useState } from 'react'
import { pixelIdentity, type ImagePixels } from './image-pixels'

// Commit the frame and its metadata together only after the browser has loaded it.
export function useLoadedPixels<T extends ImagePixels>(image: T | null, scopeKey: string, native = false) {
  const [loaded, setLoaded] = useState<{ image: T; url: string } | null>(null)
  const [failed, setFailed] = useState(false)
  const [attemptKey, setAttemptKey] = useState(0)
  const [loading, setLoading] = useState(false)
  const id = image?.id
  const url = native ? image?.imageUrl : (image?.fitImageUrl ?? image?.imageUrl)

  type Request = { image: T; url: string; native: boolean }

  const latest = useRef<Request | null>(null)
  const inFlight = useRef<{ cancel: () => void } | null>(null)
  const scope = useRef<string | undefined>(undefined)

  useEffect(
    () => () => {
      latest.current = null
      inFlight.current?.cancel()
      inFlight.current = null
    },
    [],
  )

  useEffect(() => {
    // Scope is owned by the feature; saved renderer directories are not rig identity.
    const nextScope = scopeKey

    if (!image || nextScope !== scope.current) {
      inFlight.current?.cancel()
      inFlight.current = null
      setLoaded(null)
      setLoading(false)
      setFailed(false)
    }

    scope.current = nextScope
    latest.current = image ? { image, url: url!, native } : null

    if (!latest.current || inFlight.current) return

    function load(frame: Request) {
      let cancelled = false
      let attempt = 0
      let timer: number | undefined
      let timeout: number | undefined
      let candidate: HTMLImageElement | undefined

      function detach() {
        window.clearTimeout(timeout)

        if (candidate) {
          candidate.onload = null
          candidate.onerror = null
        }
      }

      inFlight.current = {
        cancel() {
          cancelled = true
          window.clearTimeout(timer)
          detach()
        },
      }
      setLoading(true)
      setFailed(false)

      function settled(success: boolean) {
        if (cancelled) return
        detach()
        inFlight.current = null

        if (success) setLoaded({ image: frame.image, url: frame.url })
        const next = latest.current

        if (next && (pixelIdentity(next.image) !== pixelIdentity(frame.image) || next.url !== frame.url)) {
          // Complete useful work, then skip intermediate arrivals and load the newest.
          load(next)
        } else {
          setLoading(false)
          setFailed(!success)
        }
      }

      function attemptLoad() {
        candidate = new Image()
        const current = candidate

        function failedAttempt() {
          detach()

          if (cancelled) return

          if (attempt < 2) timer = window.setTimeout(attemptLoad, ++attempt * 1500)
          else settled(false)
        }

        current.onload = () => settled(true)
        current.onerror = failedAttempt
        timeout = window.setTimeout(failedAttempt, frame.native ? 60_000 : 15_000)
        current.src = frame.url
      }

      attemptLoad()
    }

    load(latest.current)
    // Immutable IDs and URLs prevent telemetry polls restarting a request.
  }, [id, url, image?.imageUrl, image?.fitImageUrl, scopeKey, native, attemptKey])

  // Facts may arrive after pixels (for example a solved-check association).
  // Remember only exact-resource updates, without making inline owner snapshots
  // cause a render loop. A new version retains the last complete old tuple.
  const facts = useRef<T | null>(null)

  const snapshot = image && loaded && pixelIdentity(image) === pixelIdentity(loaded.image)
    ? image
    : loaded && facts.current && pixelIdentity(facts.current) === pixelIdentity(loaded.image)
      ? facts.current
      : loaded?.image

  useEffect(() => { facts.current = snapshot ?? null }, [snapshot])

  return {
    loadedImage: image && scope.current === scopeKey ? (snapshot ?? null) : null,
    loadedUrl: image && scope.current === scopeKey ? loaded?.url : undefined,
    loading,
    failed,
    retry: () => setAttemptKey(value => value + 1),
  }
}

