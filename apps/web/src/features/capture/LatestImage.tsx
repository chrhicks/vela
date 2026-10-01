import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Badge, Button, IconButton } from '@vela/ui'
import type { CaptureImage } from '@vela/model/web'
import './latest-image.css'
import { api, ApiError } from '../../lib/api'
import { isSavedImage } from './validation'
import { useLoadedPixels } from '../image-inspection/useLoadedPixels'
import { useImageInspection } from '../image-inspection/useImageInspection'
import { ImageViewport, ImageEnlargement } from '../image-inspection/ImageViewport'

export type { CaptureImage } from '@vela/model/web'

// Compatibility for legacy capture/saved consumers. New viewers supply an explicit scope.
export function useLoadedImage(image: CaptureImage | null, native = false) {
  const scope = image?.imageUrl.split('/').slice(0, 4).join('/') ?? 'capture'
  const result = useLoadedPixels(image, scope, native)
  const loadedImage = result.loadedImage

  return {
    ...result,
    loadedImage: loadedImage && image?.id === loadedImage.id && image.saved
      ? { ...loadedImage, saved: true }
      : loadedImage,
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
  const inspection = useImageInspection(image, { scope: `capture:${rigId ?? ''}` })
  const { fitted, held, frame, native, nativeVisible, nativeRequested, showLatest, showFit, showNative, hold } = inspection
  const [expanded, setExpanded] = useState(false)
  const [inlineHeight, setInlineHeight] = useState<number>()
  const root = useRef<HTMLElement>(null)
  const openerId = useId()
  const detailsId = useId()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [now, setNow] = useState(Date.now)
  const lastKnown = interrupted && !savedDetail && !!frame
  const hfr = frame?.statistics?.medianHfrPixels
  const expired = native.result?.state === 'missing'
  const retention = useImageRetention(rigId)

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

  useEffect(() => { setExpanded(false) }, [rigId])

  const tools = (
    <div className="capture-image__actions">
      <div className="capture-image__zoom" role="group" aria-label="Image scale">
        <Button tone="neutral" aria-pressed={!nativeVisible}
          onClick={showFit}>Fit</Button>
        <Button tone="neutral" aria-pressed={nativeVisible}
          disabled={(expired || keepExpired) && native.result?.state !== 'ready'}
          onClick={showNative}>100%</Button>
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
          onClick={() => {
            // Keep the inline card's extent while its one viewer moves to the portal.
            setInlineHeight(root.current?.getBoundingClientRect().height)
            hold()
            setExpanded(true)
          }}>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="M5 15 15 5M6 5h9v9" />
          </svg>
        </Button>
      )}
    </div>
  )

  const viewport = (
    <ImageViewport inspection={inspection} expanded={expanded} layoutKey={lastKnown ? 'interrupted' : 'current'}
      alt={frame ? `${frame.exposureSeconds} second exposure from ${frame.cameraName}` : ''}
      empty={(
        <div className="capture-image__empty">
          <CameraMark />
          <h3>{fitted.loading ? 'Loading your exposure' : busy ? 'Taking your first exposure' : 'Your first image starts here'}</h3>
          <p>{interrupted ? 'Exposure progress is unavailable.' : 'The image will appear when it is received.'}</p>
        </div>
      )} />
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
            Star size{'   '}{hfr == null ? '—' : Number(hfr.toFixed(2))} px HFR
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
      style={expanded ? { minHeight: inlineHeight, boxSizing: 'border-box' } : undefined}
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
      <ImageEnlargement open={expanded} rootRef={root} title="Exposure inspection"
        returnFocusId={openerId} onDismiss={() => setExpanded(false)}>
        <div className="capture-image capture-image--fieldroom">
          {tools}{status}{viewport}{metadata}
        </div>
      </ImageEnlargement>
    </section>
  )
}
