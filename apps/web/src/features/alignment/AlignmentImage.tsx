import { useEffect, useRef, useState } from 'react'
import type { AlignmentDetailImage } from '@vela/model/web'
import { Button, Dialog } from '@vela/ui'
import { alignmentViewport, angularScaleLabel } from './image-viewport'
import type { AlignmentImageView, AlignmentMeasurement } from './image-viewport'

export interface AlignmentImageFrame {
  /** Native display pixels, loaded only for 100% inspection. */
  imageUrl: string
  imageWidth: number
  imageHeight: number
  fitImageUrl: string
  fitImageScale: number
  detail?: AlignmentDetailImage
  capturedAt: string | null
  capturedAtSource?: 'camera' | 'server-estimate'
  title: string
  alt: string
  solution: AlignmentMeasurement | null
}

export interface ExpandedAlignmentImage {
  frame: AlignmentImageFrame
  noSolution: boolean
}

type ReadState = 'current' | 'offline' | 'retrying'

const readMessages: Record<ReadState, string> = {
  current: '',
  retrying: ' · Retrying; pause adjustments',
  offline: ' · Connection interrupted; pause adjustments',
}

function ExposureTime({ frame }: { readonly frame: AlignmentImageFrame }) {
  if (!frame.capturedAt) return <>Exposure start unavailable</>

  return (
    <>
      {frame.capturedAtSource === 'server-estimate'
        ? 'Estimated exposure start'
        : 'Exposure started'}{' '}
      <time dateTime={frame.capturedAt}>{new Date(frame.capturedAt).toLocaleTimeString()}</time>
    </>
  )
}

function ImageCanvas({
  frame,
  view,
}: {
  readonly frame: AlignmentImageFrame
  readonly view: AlignmentImageView
}) {
  const canvas = useRef<SVGSVGElement>(null)
  const solved = frame.solution !== null
  const [size, setSize] = useState({ width: 640, height: 400 })
  useEffect(() => {
    const element = canvas.current

    if (!element) return

    const observer = new ResizeObserver(() => {
      const bounds = element.getBoundingClientRect()
      setSize({ width: bounds.width, height: bounds.height })
    })

    observer.observe(element)

    return () => observer.disconnect()
  }, [view, solved])

  const [imageError, setImageError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!imageError) return

    const timer = setTimeout(() => {
      setImageError(false)
      setAttempt((value) => value + 1)
    }, 1500)

    return () => clearTimeout(timer)
  }, [imageError, attempt])
  const [nativeLoaded, setNativeLoaded] = useState(false)

  const imageEvents = { onError: () => setImageError(true), onLoad: () => setImageError(false) }

  const warning = imageError && (
    <p role="status">The exposure preview could not be loaded. Retrying…</p>
  )

  if (view === 'native')
    return (
      <>
        <div
          className="vela-polar-native"
          tabIndex={0}
          role="region"
          aria-label="Native image, scroll to inspect"
        >
          <img
            key={attempt}
            src={frame.imageUrl}
            width={frame.imageWidth}
            height={frame.imageHeight}
            style={{ width: frame.imageWidth, height: frame.imageHeight }}
            alt={frame.alt}
            onError={imageEvents.onError}
            onLoad={() => {
              setImageError(false)
              setNativeLoaded(true)
            }}
          />
        </div>
        {!nativeLoaded && !imageError && <p role="status">Loading full-resolution image…</p>}
        {warning}
      </>
    )

  if (!frame.solution)
    return (
      <>
        <img
          key={attempt}
          src={frame.fitImageUrl}
          width={frame.imageWidth}
          height={frame.imageHeight}
          alt={frame.alt}
          {...imageEvents}
        />
        {warning}
      </>
    )

  const m = frame.solution
  const box = alignmentViewport(m, view)
  const scale = Math.max(box.width / Math.max(size.width, 1), box.height / Math.max(size.height, 1))
  // Each fit pixel covers fitImageScale native pixels from the origin, so the last may overhang.
  const fitWidth = Math.ceil(frame.imageWidth / frame.fitImageScale) * frame.fitImageScale
  const fitHeight = Math.ceil(frame.imageHeight / frame.fitImageScale) * frame.fitImageScale

  return (
    <div className="vela-polar-image-canvas">
      <svg
        ref={canvas}
        viewBox={`${box.left} ${box.top} ${box.width} ${box.height}`}
        role="img"
        aria-label={frame.alt}
      >
        <image
          key={`fit-${attempt}`}
          href={frame.fitImageUrl}
          width={fitWidth}
          height={fitHeight}
          preserveAspectRatio="none"
          {...imageEvents}
        />
        {frame.detail && view !== 'full' && (
          <image
            key={`detail-${attempt}`}
            href={frame.detail.imageUrl}
            x={frame.detail.x}
            y={frame.detail.y}
            width={frame.detail.width}
            height={frame.detail.height}
            preserveAspectRatio="none"
            {...imageEvents}
          />
        )}
        <path
          d={`M${box.referenceX} ${box.referenceY}L${m.targetX} ${m.targetY}`}
          fill="none"
          stroke="var(--vela-polar-target)"
          strokeWidth={2 * scale}
        />
        <circle
          data-marker="reference"
          cx={box.referenceX}
          cy={box.referenceY}
          r={8 * scale}
          fill="none"
          stroke="var(--vela-polar-reference)"
          strokeWidth={scale}
        />
        <path
          data-marker="reference-crosshair"
          d={`M${box.referenceX - 18 * scale} ${box.referenceY}h${12 * scale}m${12 * scale} 0h${12 * scale}M${box.referenceX} ${box.referenceY - 18 * scale}v${12 * scale}m0 ${12 * scale}v${12 * scale}`}
          fill="none"
          stroke="var(--vela-polar-reference)"
          strokeWidth={2 * scale}
        />
        <g data-marker="target">
          <circle
            cx={m.targetX}
            cy={m.targetY}
            r={13 * scale}
            fill="none"
            stroke="var(--vela-polar-target)"
            strokeWidth={2 * scale}
          />
          <circle cx={m.targetX} cy={m.targetY} r={3 * scale} fill="var(--vela-polar-target)" />
        </g>
      </svg>
      <div
        className="vela-polar-angular-scale"
        aria-label={`Approximate angular scale ${angularScaleLabel(box.barArcsec)}`}
      >
        <span>≈ {angularScaleLabel(box.barArcsec)}</span>
        <i />
      </div>
      {warning}
    </div>
  )
}

function InspectionView({
  frame,
  readState,
  now,
  retained,
  superseded = false,
  newerImageUnavailable = false,
  noSolution,
  expanded = false,
  openerId,
  onEnlarge,
}: {
  readonly frame: AlignmentImageFrame
  readonly readState: ReadState
  readonly now: number
  readonly retained: boolean
  /** A newer correction is shown above; this image belongs to an earlier one. */
  readonly superseded?: boolean
  /** The newer correction's image failed to load and is retrying. */
  readonly newerImageUnavailable?: boolean
  readonly noSolution: boolean
  readonly expanded?: boolean
  readonly openerId?: string
  readonly onEnlarge?: () => void
}) {
  const [view, setView] = useState<AlignmentImageView>(frame.solution ? 'fit' : 'full')

  const box = frame.solution
    ? alignmentViewport(frame.solution, view === 'native' ? 'full' : view)
    : null

  const age = frame.capturedAt
    ? `${Math.max(0, Math.floor((now - Date.parse(frame.capturedAt)) / 1000))} seconds old`
    : 'Age unavailable'

  let solvedStatus = 'Last solved frame'

  if (superseded) {
    solvedStatus = `Earlier solved frame · ${age} · ${
      newerImageUnavailable ? 'Newer image unavailable' : 'Newer image loading'
    }`
  }
  else if (retained || readState !== 'current') solvedStatus = `Last solved frame · ${age}`

  const status = frame.solution
    ? solvedStatus
    : noSolution
      ? 'No solution · Exposure retained for inspection. No alignment result yet.'
      : 'No alignment result yet'

  const descriptions: Record<AlignmentImageView, string> = {
    fit: 'Fit both · Padded context, 4′ minimum vertical field',
    fine: '1′ vertical field · Midpoint of reference and target',
    full: 'Full frame',
    native: '100% · 1 image pixel = 1 CSS pixel · Scroll to inspect · Overlay hidden',
  }

  return (
    <div className="vela-polar-inspection" data-expanded={expanded || undefined}>
      <div className="vela-polar-image-opening">
        <ImageCanvas key={frame.imageUrl} frame={frame} view={view} />
        {!expanded && (
          <button
            id={openerId}
            type="button"
            className="vela-polar-enlarge"
            aria-label="Enlarge image"
            onClick={onEnlarge}
          >
            ⤢
          </button>
        )}
      </div>
      <p className="vela-polar-inspection-status">
        {status}
        {expanded && readMessages[readState]}
      </p>
      {frame.solution && view !== 'native' && (
        <div className="vela-polar-inspection-legend">
          <span>Crosshair: optical center</span>
          <span>Ring: correction target</span>
        </div>
      )}
      {box?.outsideImage && (
        <p className="vela-polar-inspection-note">
          Target outside captured image · Blank area has no image data.
        </p>
      )}
      {view === 'fine' && box?.markersClipped && (
        <p className="vela-polar-inspection-note">
          Markers outside this fine view. Use Fit both to see the correction.
        </p>
      )}
      <div className="vela-polar-inspection-tools" aria-label="Image view">
        {frame.solution && (
          <>
            <Button aria-pressed={view === 'fit'} onClick={() => setView('fit')}>
              Fit both
            </Button>
            <Button
              aria-label="Fine · 1′"
              aria-pressed={view === 'fine'}
              onClick={() => setView('fine')}
            >
              Fine
            </Button>
          </>
        )}
        <Button aria-pressed={view === 'full'} onClick={() => setView('full')}>
          Full frame
        </Button>
        {expanded && (
          <Button aria-pressed={view === 'native'} onClick={() => setView('native')}>
            100%
          </Button>
        )}
      </div>
      {expanded && (
        <>
          <p className="vela-polar-inspection-meta">
            {descriptions[view]}
            {box && view !== 'native' && ' · Approximate scale from camera field'}
          </p>
          <p className="vela-polar-inspection-time">
            <ExposureTime frame={frame} /> · Retained for inspection
          </p>
        </>
      )}
    </div>
  )
}

export function AlignmentImage({
  frame,
  readState,
  now,
  retained,
  superseded = false,
  newerImageUnavailable = false,
  noSolution = false,
  openerId,
  onEnlarge,
}: {
  readonly frame: AlignmentImageFrame
  readonly readState: ReadState
  readonly now: number
  readonly retained: boolean
  readonly superseded?: boolean
  readonly newerImageUnavailable?: boolean
  readonly noSolution?: boolean
  readonly openerId: string
  readonly onEnlarge: (image: ExpandedAlignmentImage) => void
}) {
  return (
    <figure className="vela-polar-image">
      <InspectionView
        frame={frame}
        readState={readState}
        now={now}
        retained={retained}
        superseded={superseded}
        newerImageUnavailable={newerImageUnavailable}
        noSolution={noSolution}
        openerId={openerId}
        onEnlarge={() => onEnlarge({ frame, noSolution })}
      />
    </figure>
  )
}

export function AlignmentImageDialog({
  image,
  readState,
  now,
  openerId,
  onDismiss,
}: {
  readonly image: ExpandedAlignmentImage | null
  readonly readState: ReadState
  readonly now: number
  readonly openerId: string
  readonly onDismiss: () => void
}) {
  return (
    <Dialog
      open={image !== null}
      title={image?.frame.title ?? 'Exposure inspection'}
      description="Same exposure · Inspection takes no new image."
      returnFocusId={openerId}
      onDismiss={onDismiss}
      className="vela-polar-inspection-dialog"
    >
      {image && (
        <InspectionView
          frame={image.frame}
          readState={readState}
          now={now}
          retained
          noSolution={image.noSolution}
          expanded
        />
      )}
    </Dialog>
  )
}
