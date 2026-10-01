import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Badge, Button, Dialog, IconButton } from '@vela/ui'
import type { CaptureImage } from '@vela/model/web'
import './latest-image.css'
import { api, ApiError } from '../../lib/api'
import { isSavedImage } from './validation'
import { useNativeImage } from './useNativeImage'

export type { CaptureImage } from '@vela/model/web'

// Commit the frame and its metadata together only after the browser has loaded it.
export function useLoadedImage(image: CaptureImage | null, native = false) {
  const [loaded, setLoaded] = useState<{ image: CaptureImage; url: string } | null>(null)
  const [failed, setFailed] = useState(false)
  const [attemptKey, setAttemptKey] = useState(0)
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
  }, [id, url, native, attemptKey])

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
    retry: () => setAttemptKey(value => value + 1),
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

type LatestImageProps = {
  rigId?: string
  savedDetail?: boolean
  fieldroom?: boolean
  image: CaptureImage | null
  busy: boolean
  interrupted: boolean
}

export function LatestImage(props: LatestImageProps) {
  return props.fieldroom ? <FieldroomLatestImage {...props} /> : <LegacyLatestImage {...props} />
}

function LegacyLatestImage({
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
                tone={nativeVisible ? 'quiet' : 'neutral'}
                aria-pressed={!nativeVisible}
                onClick={() => setZoomed(false)}
              >
                Fit
              </Button>
              <Button
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
            <Button onClick={() => void keep(result.image)}>
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

function FieldroomLatestImage({ image, busy, interrupted, rigId, savedDetail = false }: LatestImageProps) {
  const fitted = useLoadedImage(image)
  const [held, setHeld] = useState<{ image: CaptureImage; url: string } | null>(null)
  const [mode, setMode] = useState<'fit' | 'native'>('fit')
  const [nativeRequested, setNativeRequested] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const root = useRef<HTMLElement>(null)
  const [overlayHost, setOverlayHost] = useState<Element | null>(null)
  const openerId = useId()
  const detailsId = useId()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [now, setNow] = useState(Date.now)
  const frame = held?.image ?? fitted.loadedImage
  const lastKnown = interrupted && !savedDetail && !!frame
  const fitUrl = held?.url ?? fitted.loadedUrl
  const hfr = frame?.statistics?.medianHfrPixels
  const native = useNativeImage(held?.image ?? null, nativeRequested)
  const nativeVisible = mode === 'native' && native.result?.state === 'ready'
  const expired = native.result?.state === 'expired'
  const retention = useImageRetention(rigId)
  const windowRef = useRef<HTMLDivElement>(null)
  const pan = useRef<{ x: number; y: number } | null>(null)
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)

  const saved = !!frame && (savedDetail || frame.saved ||
    (image?.id === frame.id && image.saved) ||
    (retention.result?.image.id === frame.id && retention.result.status === 'saved'))

  const keepExpired = retention.result?.status === 'failed' &&
    retention.result.image.id === frame?.id && !retention.result.retryable

  useEffect(() => {
    if (!lastKnown) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)

    return () => window.clearInterval(timer)
  }, [lastKnown, frame?.receivedAt])

  const seconds = frame ? Math.max(0, Math.floor((now - Date.parse(frame.receivedAt)) / 1000)) : 0

  const age = seconds < 60
    ? `${seconds} s ago`
    : seconds < 3600
      ? `${Math.floor(seconds / 60)} min ago`
      : `${Math.floor(seconds / 3600)} h ago`

  useEffect(() => {
    setOverlayHost(root.current?.closest('.vela-theme') ?? null)
  }, [])

  useEffect(() => {
    if (!expanded || !overlayHost) return

    // The app theme owns the overlay, outside the route's fixed containing block.
    const background = Array.from(overlayHost.children).filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && !element.hasAttribute('data-image-overlay'),
    )

    const previousInert = background.map(element => element.inert)
    const previousOverflow = document.body.style.overflow
    background.forEach(element => { element.inert = true })
    document.body.style.overflow = 'hidden'

    return () => {
      background.forEach((element, index) => { element.inert = previousInert[index]! })
      document.body.style.overflow = previousOverflow
    }
  }, [expanded, overlayHost])

  function hold() {
    if (!held && frame && fitUrl) setHeld({ image: frame, url: fitUrl })
  }

  function showLatest() {
    setMode('fit')
    setNativeRequested(false)
    setHeld(null)
    pan.current = null
  }

  useEffect(() => {
    showLatest()
    setExpanded(false)
  }, [rigId])

  useLayoutEffect(() => {
    const viewport = windowRef.current

    if (!viewport) return
    viewport.scrollLeft = nativeVisible
      ? Math.max(0, (pan.current?.x ?? viewport.scrollWidth / 2) - viewport.clientWidth / 2)
      : 0
    viewport.scrollTop = nativeVisible
      ? Math.max(0, (pan.current?.y ?? viewport.scrollHeight / 2) - viewport.clientHeight / 2)
      : 0
  }, [expanded, nativeVisible, frame?.id, lastKnown])

  const tools = (
    <div className="capture-image__actions">
      <div className="capture-image__zoom" role="group" aria-label="Image scale">
        <Button tone="neutral" aria-pressed={!nativeVisible}
          onClick={() => setMode('fit')}>Fit</Button>
        <Button tone="neutral" aria-pressed={nativeVisible}
          disabled={(expired || keepExpired) && native.result?.state !== 'ready'}
          onClick={() => { hold(); setMode('native'); setNativeRequested(true) }}>100%</Button>
      </div>
      <IconButton
        label="Image details"
        tone="quiet"
        aria-expanded={detailsOpen}
        aria-controls={detailsId}
        onClick={() => setDetailsOpen(value => !value)}
        icon={(
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
            <circle cx="10" cy="10" r="7" />
            <path d="M10 9v5m0-9v1" />
          </svg>
        )}
      />
      {!expanded && (
        <Button id={openerId} aria-label="Enlarge image" className="capture-image__enlarge"
          onClick={() => { hold(); setExpanded(true) }}>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="M5 15 15 5M6 5h9v9" />
          </svg>
        </Button>
      )}
    </div>
  )

  const viewport = (
    <div className="capture-image__window" data-zoomed={nativeVisible || undefined}
      ref={windowRef} tabIndex={nativeVisible ? 0 : undefined}
      role={nativeVisible ? 'region' : undefined}
      aria-label={nativeVisible ? 'Image at 100 percent. Drag or use arrow keys to inspect.' : undefined}
      onScroll={event => {
        if (nativeVisible) pan.current = {
          x: event.currentTarget.scrollLeft + event.currentTarget.clientWidth / 2,
          y: event.currentTarget.scrollTop + event.currentTarget.clientHeight / 2,
        }
      }}
      onKeyDown={event => {
        if (!nativeVisible) return

        const steps = new Map<string, readonly [number, number]>([
          ['ArrowLeft', [-80, 0]], ['ArrowRight', [80, 0]],
          ['ArrowUp', [0, -80]], ['ArrowDown', [0, 80]],
        ])

        const step = steps.get(event.key)

        if (!step) return
        event.preventDefault()
        event.currentTarget.scrollBy(step[0], step[1])
      }}
      onPointerDown={event => {
        if (!nativeVisible || event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop }
      }}
      onPointerMove={event => {
        if (!drag.current) return
        event.currentTarget.scrollLeft = drag.current.left + drag.current.x - event.clientX
        event.currentTarget.scrollTop = drag.current.top + drag.current.y - event.clientY
      }}
      onPointerUp={() => { drag.current = null }}
      onPointerCancel={() => { drag.current = null }}
    >
      {frame ? (
        <img src={nativeVisible ? native.result?.url : fitUrl} width={frame.width} height={frame.height}
          style={nativeVisible ? { width: frame.width, height: frame.height } : undefined}
          draggable={false} alt={`${frame.exposureSeconds} second exposure from ${frame.cameraName}`} />
      ) : (
        <div className="capture-image__empty">
          <CameraMark />
          <h3>{fitted.loading ? 'Loading your exposure' : busy ? 'Taking your first exposure' : 'Your first image starts here'}</h3>
          <p>{interrupted ? 'Exposure progress is unavailable.' : 'The image will appear when it is received.'}</p>
        </div>
      )}
    </div>
  )

  const status = (
    <>
      {held && (
        <div className="capture-image__inspection-status" role="status">
          <span>{image?.id !== held.image.id ? 'A newer exposure is available.' : 'Holding this exposure for inspection.'}</span>
          <Button onClick={showLatest}>Show latest</Button>
        </div>
      )}
      {nativeRequested && native.result?.state === 'loading' && (
        <p className="capture-image__error" role="status">Loading full-resolution image… The fitted preview stays visible.</p>
      )}
      {native.result?.state === 'failed' && (
        <div className="capture-image__error" role="status">
          The full-resolution image could not be loaded. The fitted preview is kept.
          <Button onClick={native.retry}>Retry full-resolution image</Button>
        </div>
      )}
      {(expired || keepExpired) && (
        <p className="capture-image__error" role="status">This exposure has expired from the camera cache. Loaded pixels remain available; native loading and Keep are unavailable.</p>
      )}
      {!held && fitted.failed && (
        <div className="capture-image__error" role="status">
          The latest image could not be loaded. {frame ? 'The previous exposure is kept.' : 'No image is available.'}
          <Button onClick={fitted.retry}>Retry image</Button>
        </div>
      )}
      {retention.result && (retention.result.image.id !== frame?.id || retention.result.status === 'failed') && (
        <div className="capture-image__retention" role="status" data-failed={retention.result.status === 'failed' || undefined}>
          {retentionMessage(retention.result, retention.keep)}
        </div>
      )}
    </>
  )

  const metadata = frame && (
    <>
      <div className="capture-image__metadata">
        <div className="capture-image__caption">
          {frame.cameraName}
        </div>
        <div className="capture-image__facts">
          <span>{frame.exposureSeconds} s · {frame.color === 'color' ? 'Color' : 'Mono'} exposure</span>
          <span className="capture-image__star-size" title="Median half-flux radius in native image pixels">
            Star size <span>{hfr == null ? '—' : Number(hfr.toFixed(2))} px HFR</span>
          </span>
          <span>{frame.statistics ? `${frame.statistics.detectedStars} stars` : 'Star measurements unavailable'}</span>
        </div>
        {saved ? (
          <span className="capture-image__saved">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
              <path d="m3 8 3 3 7-7" />
            </svg>
            Saved
          </span>
        ) : rigId && (
          <Button className="capture-image__keep" disabled={retention.pending || expired || keepExpired}
            onClick={() => void retention.keep(frame)}>
            {retention.pending && retention.result?.image.id === frame.id ? 'Saving…' : 'Keep'}
          </Button>
        )}
      </div>
      <div className="capture-image__details" id={detailsId} hidden={!detailsOpen}>
        <h3>Image details</h3>
        <dl>
          {frame.subject && <div><dt>Chosen subject</dt><dd>{frame.subject.name} · {frame.subject.catalog}</dd></div>}
          <div><dt>Dimensions</dt><dd>{frame.width} × {frame.height}</dd></div>
          <div><dt>Exposure started{frame.capturedAtSource === 'server-estimate' ? ' (estimated)' : ''}</dt><dd>{new Date(frame.capturedAt).toLocaleString()}</dd></div>
          <div><dt>Display</dt><dd>{nativeVisible ? '100% · One image pixel per CSS pixel' : 'Fitted · Display stretched'}</dd></div>
        </dl>
      </div>
    </>
  )

  return (
    <section ref={root} className="capture-image capture-image--fieldroom"
      data-interrupted={lastKnown || undefined} aria-label={savedDetail ? 'Saved preview' : 'Latest image'}>
      <header>
        <div className="capture-image__heading">
          <h2>{savedDetail ? 'Saved exposure' : lastKnown ? 'Last received exposure' : 'Latest exposure'}</h2>
          <span title={frame ? `Received ${new Date(frame.receivedAt).toLocaleString()}` : undefined}>
            {frame ? new Date(frame.receivedAt).toLocaleTimeString(undefined, {
              hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
            }) : 'No exposure yet'}
            {lastKnown && ` · ${age}`}
          </span>
        </div>
        {frame && !expanded && tools}
      </header>
      {!expanded && <>{status}{viewport}{metadata}</>}
      {expanded && overlayHost && createPortal(
        <div data-image-overlay>
          <Dialog open title="Exposure inspection" returnFocusId={openerId}
            onDismiss={() => setExpanded(false)} className="capture-image-dialog">
            <div className="capture-image capture-image--fieldroom">
              {tools}{status}{viewport}{metadata}
            </div>
          </Dialog>
        </div>,
        overlayHost,
      )}
    </section>
  )
}
