import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Badge, Button } from '@vela/ui'
import type { CaptureImage } from '@vela/model/web'
import './latest-image.css'
import { api, ApiError } from '../../lib/api'
import { isSavedImage } from './validation'

export type { CaptureImage } from '@vela/model/web'

// Commit the frame and its metadata together only after the browser has loaded it.
export function useLoadedImage(image: CaptureImage | null, native = false) {
  const [loaded, setLoaded] = useState<{ image: CaptureImage; url: string } | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(false)
  const id = image?.id
  const url = native ? image?.imageUrl : (image?.fitImageUrl ?? image?.imageUrl)

  type Request = { image: CaptureImage; url: string; native: boolean }

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
    // Native image URLs share a Rig-specific directory. Never keep a different Rig's image.
    const nextScope = image?.imageUrl.slice(0, image.imageUrl.lastIndexOf('/'))

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

        if (next && (next.image.id !== frame.image.id || next.url !== frame.url)) {
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
  }, [id, url, native])

  useEffect(() => {
    if (image?.saved)
      setLoaded(current =>
        current?.image.id === image.id && !current.image.saved
          ? { ...current, image: { ...current.image, saved: true } }
          : current,
      )
  }, [id, image?.saved, loaded?.image.id])

  return {
    loadedImage: image ? (loaded?.image ?? null) : null,
    loadedUrl: image ? loaded?.url : undefined,
    loading,
    failed,
  }
}

export function CameraMark() {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="6" y="12" width="36" height="26" rx="5" />
      <path d="m15 12 3-5h12l3 5M35 19h2" />
      <circle cx="24" cy="25" r="8" />
      <circle cx="24" cy="25" r="3" />
    </svg>
  )
}

export function LatestImage({
  image,
  busy,
  interrupted,
  rigId,
  savedDetail = false,
}: {
  rigId?: string
  savedDetail?: boolean
  image: CaptureImage | null
  busy: boolean
  interrupted: boolean
}) {
  const [zoomed, setZoomed] = useState(false)
  const { loadedImage: frame, loadedUrl, loading, failed } = useLoadedImage(image, zoomed)
  const nativeVisible = !!frame && zoomed && loadedUrl === frame.imageUrl
  const loadingNative = zoomed && !nativeVisible && loading
  const [now, setNow] = useState(Date.now)
  const imageWindow = useRef<HTMLDivElement>(null)
  const retention = useImageRetention(rigId)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)

    return () => window.clearInterval(timer)
  }, [])

  useLayoutEffect(() => {
    const viewport = imageWindow.current

    if (!viewport) return
    viewport.scrollLeft =
      nativeVisible && frame ? Math.max(0, (frame.width - viewport.clientWidth) / 2) : 0
    viewport.scrollTop =
      nativeVisible && frame ? Math.max(0, (frame.height - viewport.clientHeight) / 2) : 0
  }, [nativeVisible, frame?.id])

  const seconds = frame ? Math.max(0, Math.floor((now - Date.parse(frame.receivedAt)) / 1000)) : 0

  const age =
    seconds < 60
      ? `${seconds} s ago`
      : seconds < 3600
        ? `${Math.floor(seconds / 60)} min ago`
        : `${Math.floor(seconds / 3600)} h ago`

  const previous = busy || interrupted || (!!frame && frame.id !== image?.id)

  const frameSaved =
    !!frame &&
    (frame.saved ||
      (image?.id === frame.id && image.saved) ||
      (retention.result?.image.id === frame.id && retention.result.status === 'saved'))

  return (
    <section className="capture-image" aria-label={savedDetail ? 'Saved preview' : 'Latest image'}>
      <header>
        <div>
          <h2>
            {savedDetail && frame
              ? new Date(frame.capturedAt).toLocaleTimeString()
              : 'Latest image'}
          </h2>
          <span>
            {savedDetail && frame
              ? new Date(frame.capturedAt).toLocaleDateString()
              : frame
                ? `${age}${previous ? ' · Previous exposure' : ''}`
                : loading
                  ? 'Loading image…'
                  : 'No exposure yet'}
          </span>
        </div>
        {frame && (
          <div className="capture-image__actions">
            <div className="capture-image__zoom" role="group" aria-label="Image scale">
              <Button
                size="small"
                tone={nativeVisible ? 'quiet' : 'neutral'}
                aria-pressed={!nativeVisible}
                onClick={() => setZoomed(false)}
              >
                Fit
              </Button>
              <Button
                size="small"
                tone={nativeVisible ? 'neutral' : 'quiet'}
                aria-pressed={nativeVisible}
                onClick={() => setZoomed(true)}
              >
                100%
              </Button>
            </div>
            {savedDetail || frameSaved ? (
              <Badge tone="positive">Saved</Badge>
            ) : (
              rigId && (
                <Button
                  size="small"
                  disabled={retention.pending}
                  onClick={() => void retention.keep(frame)}
                >
                  {retention.pending && retention.result?.image.id === frame.id
                    ? 'Saving…'
                    : 'Keep this image'}
                </Button>
              )
            )}
          </div>
        )}
      </header>
      {retention.result &&
        (retention.result.image.id !== frame?.id || retention.result.status === 'failed') && (
          <div
            className="capture-image__retention"
            data-failed={retention.result.status === 'failed' || undefined}
            role="status"
          >
            {retentionMessage(retention.result, retention.keep)}
          </div>
        )}
      {loadingNative && (
        <p className="capture-image__error" role="status">
          Loading full-resolution image… The fitted preview stays visible.
        </p>
      )}
      {failed && (
        <p className="capture-image__error" role="status">
          {zoomed && frame?.id === image?.id
            ? 'The full-resolution image could not be loaded. The fitted preview is kept below.'
            : `The latest image could not be loaded.${frame ? ' The previous exposure is kept below.' : ' No image is available to display.'}`}
        </p>
      )}
      <div
        className="capture-image__window"
        data-zoomed={nativeVisible || undefined}
        ref={imageWindow}
        tabIndex={nativeVisible ? 0 : undefined}
        role={nativeVisible ? 'region' : undefined}
        aria-label={nativeVisible ? 'Image at 100 percent. Scroll to inspect.' : undefined}
      >
        {frame ? (
          <img
            src={loadedUrl}
            width={frame.width}
            height={frame.height}
            style={nativeVisible ? { width: frame.width, height: frame.height } : undefined}
            alt={`${frame.exposureSeconds} second exposure from ${frame.cameraName}`}
          />
        ) : (
          <div className="capture-image__empty">
            <CameraMark />
            <h3>
              {loading
                ? 'Loading your exposure'
                : interrupted
                  ? 'Waiting for your first image'
                  : busy
                    ? 'Taking your first exposure'
                    : 'Your first image starts here'}
            </h3>
            <p>
              {interrupted
                ? 'Exposure progress is unavailable. The image will appear when it is received.'
                : busy || loading
                  ? 'The image will appear when it is received.'
                  : 'Choose an exposure time, then take an image to check what the camera sees.'}
            </p>
          </div>
        )}
      </div>

      {frame && (
        <div className="capture-image__statistics">
          <dl aria-label="Image statistics">
            <div>
              <dt>Dimensions</dt>
              <dd>
                {frame.width} × {frame.height}
              </dd>
            </div>
            <div>
              <dt title="Detected stars with a reliable measurement">Stars</dt>
              <dd>{frame.statistics?.detectedStars ?? '—'}</dd>
            </div>
            <div>
              <dt title="Median half-flux radius in native image pixels">HFR · px</dt>
              <dd>{frame.statistics?.medianHfrPixels?.toFixed(2) ?? '—'}</dd>
            </div>
          </dl>
          {frame.capturedAtSource === 'server-estimate' && <p>Start time estimated</p>}
          {!frame.statistics ? (
            <p>Star measurements unavailable for this image.</p>
          ) : frame.statistics.detectedStars === 0 ? (
            <p>No measurable stars in this image.</p>
          ) : null}
        </div>
      )}
      {frame && (
        <footer>
          <span>
            {frame.exposureSeconds} s <i>·</i> {frame.color === 'color' ? 'Color' : 'Mono'}
          </span>
          <span>{nativeVisible ? 'Scroll to inspect' : 'Display stretched'}</span>
        </footer>
      )}
    </section>
  )
}

type KeptFrame = Pick<CaptureImage, 'id' | 'capturedAt'>

type KeepResult = { image: KeptFrame } & (
  | { status: 'saving' }
  | { status: 'saved' }
  | { status: 'failed'; error: string; retryable: boolean }
)

function retentionMessage(result: KeepResult, keep: (image: KeptFrame) => Promise<void>) {
  const time = new Date(result.image.capturedAt).toLocaleTimeString()

  switch (result.status) {
    case 'saving':
      return `Saving image from ${time}…`
    case 'saved':
      return `Image from ${time} saved.`
    case 'failed':
      return (
        <>
          <p>
            Image from {time}: {result.error}
          </p>
          {result.retryable && (
            <Button size="small" onClick={() => void keep(result.image)}>
              Retry saving image
            </Button>
          )}
        </>
      )
  }
}

// A save belongs to the selected image, not to the lifetime of its displayed pixels.
function useImageRetention(rigId: string | undefined) {
  const [result, setResult] = useState<KeepResult | null>(null)
  const writing = useRef(false)

  async function keep(image: KeptFrame) {
    if (!rigId || writing.current) return
    writing.current = true
    setResult({ image, status: 'saving' })

    try {
      const response = await api(
        `rigs/${encodeURIComponent(rigId)}/capture/images/${encodeURIComponent(image.id)}/keep`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
          signal: AbortSignal.timeout(30_000),
        },
      )

      if (!isSavedImage(response, rigId) || response.id !== image.id)
        throw new Error('Invalid saved image response')
      setResult({ image, status: 'saved' })
    } catch (cause) {
      const expired = cause instanceof ApiError && cause.status === 410
      setResult({
        image,
        status: 'failed',
        retryable: !expired,
        error: expired
          ? 'This exposure is no longer available to save. Keep a newer image, or turn on Save frames before capturing.'
          : 'Saving could not be confirmed. Check Saved images, or retry saving this image.',
      })
    } finally {
      writing.current = false
    }
  }

  return { result, pending: result?.status === 'saving', keep }
}
