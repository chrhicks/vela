import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button } from '@vela/ui'
import type { CaptureImage } from '@vela/model/web'
import './latest-image.css'

export type { CaptureImage } from '@vela/model/web'

// Commit the frame and its metadata together only after the browser has loaded it.
export function useLoadedImage(image: CaptureImage | null) {
  const [loadedImage, setLoadedImage] = useState<CaptureImage | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(false)
  const id = image?.id
  const url = image?.imageUrl

  useEffect(() => {
    setFailed(false)
    if (!image) {
      setLoadedImage(null)
      setLoading(false)
      return
    }

    const frame = image
    let cancelled = false
    let attempt = 0
    let timer: number | undefined
    let timeout: number | undefined
    let candidate: HTMLImageElement | undefined
    setLoading(true)

    function load() {
      candidate = new Image()
      const current = candidate
      function failedAttempt() {
        current.onload = null
        current.onerror = null
        window.clearTimeout(timeout)
        if (cancelled) return
        if (attempt < 2) {
          timer = window.setTimeout(load, ++attempt * 1500)
        } else {
          setLoading(false)
          setFailed(true)
        }
      }
      current.onload = () => {
        window.clearTimeout(timeout)
        current.onload = null
        current.onerror = null
        if (cancelled) return
        setLoadedImage(frame)
        setLoading(false)
      }
      current.onerror = failedAttempt
      timeout = window.setTimeout(failedAttempt, 15_000)
      current.src = frame.imageUrl
    }
    load()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      window.clearTimeout(timeout)
      if (candidate) {
        candidate.onload = null
        candidate.onerror = null
      }
    }
    // Frame IDs are immutable: telemetry updates must not restart an image request.
  }, [id, url])

  return { loadedImage: image ? loadedImage : null, loading, failed }
}

export function CameraMark() {
  return <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <rect x="6" y="12" width="36" height="26" rx="5" />
    <path d="m15 12 3-5h12l3 5M35 19h2" />
    <circle cx="24" cy="25" r="8" /><circle cx="24" cy="25" r="3" />
  </svg>
}

export function LatestImage({ image, busy, interrupted }: {
  image: CaptureImage | null
  busy: boolean
  interrupted: boolean
}) {
  const { loadedImage: frame, loading, failed } = useLoadedImage(image)
  const [zoomed, setZoomed] = useState(false)
  const [now, setNow] = useState(Date.now)
  const imageWindow = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useLayoutEffect(() => {
    const viewport = imageWindow.current
    if (!viewport) return
    viewport.scrollLeft = zoomed && frame ? Math.max(0, (frame.width - viewport.clientWidth) / 2) : 0
    viewport.scrollTop = zoomed && frame ? Math.max(0, (frame.height - viewport.clientHeight) / 2) : 0
  }, [zoomed, frame?.id])

  const seconds = frame ? Math.max(0, Math.floor((now - Date.parse(frame.receivedAt)) / 1000)) : 0
  const age = seconds < 60 ? `${seconds} s ago` : seconds < 3600 ? `${Math.floor(seconds / 60)} min ago` : `${Math.floor(seconds / 3600)} h ago`
  const previous = busy || interrupted || loading || failed

  return <section className="capture-image" aria-label="Latest image">
    <header>
      <div><h2>Latest image</h2><span>{frame ? `${age}${previous ? ' · Previous exposure' : ''}` : loading ? 'Loading image…' : 'No exposure yet'}</span></div>
      {frame && <div className="capture-image__zoom" role="group" aria-label="Image scale">
        <Button size="small" tone={zoomed ? 'quiet' : 'neutral'} aria-pressed={!zoomed} onClick={() => setZoomed(false)}>Fit</Button>
        <Button size="small" tone={zoomed ? 'neutral' : 'quiet'} aria-pressed={zoomed} onClick={() => setZoomed(true)}>100%</Button>
      </div>}
    </header>
    {failed && <p className="capture-image__error" role="status">The latest image could not be loaded.{frame ? ' The previous exposure is kept below.' : ' No image is available to display.'}</p>}
    <div className="capture-image__window" data-zoomed={frame && zoomed || undefined} ref={imageWindow}
      tabIndex={frame && zoomed ? 0 : undefined} role={frame && zoomed ? 'region' : undefined}
      aria-label={frame && zoomed ? 'Image at 100 percent. Scroll to inspect.' : undefined}>
      {frame ? <img src={frame.imageUrl} width={frame.width} height={frame.height}
        style={zoomed ? { width: frame.width, height: frame.height } : undefined}
        alt={`${frame.exposureSeconds} second exposure from ${frame.cameraName}`} />
        : <div className="capture-image__empty"><CameraMark />
          <h3>{loading ? 'Loading your exposure' : busy ? 'Taking your first exposure' : 'Your first image starts here'}</h3>
          <p>{busy || loading ? 'The image will appear when it is received.' : 'Choose an exposure time, then take an image to check what the camera sees.'}</p>
        </div>}
    </div>
    {frame && <footer>
      <span>{frame.exposureSeconds} s <i>·</i> {frame.color === 'color' ? 'Color' : 'Mono'} <i>·</i> {frame.width} × {frame.height}</span>
      <span>{zoomed ? 'Scroll to inspect' : 'Display stretched'}</span>
    </footer>}
  </section>
}
