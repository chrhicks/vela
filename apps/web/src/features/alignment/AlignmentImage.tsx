import { useEffect, useState } from 'react'
import { Button, Dialog } from '@vela/ui'
import { alignmentViewport, angularScaleLabel } from './image-viewport'
import type { AlignmentImageView, AlignmentMeasurement } from './image-viewport'

export interface AlignmentImageFrame {
  imageUrl: string
  imageWidth: number
  imageHeight: number
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
  const [imageError, setImageError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!imageError) return

    const timer = setTimeout(() => {
      setImageError(false)
      setAttempt(value => value + 1)
    }, 1500)

    return () => clearTimeout(timer)
  }, [imageError, attempt])
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
            {...imageEvents}
          />
        </div>
        {warning}
      </>
    )

  if (!frame.solution)
    return (
      <>
        <img
          key={attempt}
          src={frame.imageUrl}
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
  const scale = box.width / 640

  return (
    <div className="vela-polar-image-canvas">
      <svg
        viewBox={`${box.left} ${box.top} ${box.width} ${box.height}`}
        role="img"
        aria-label={frame.alt}
      >
        <image
          key={attempt}
          href={frame.imageUrl}
          width={frame.imageWidth}
          height={frame.imageHeight}
          {...imageEvents}
        />
        <path
          d={`M${box.referenceX} ${box.referenceY}L${m.targetX} ${m.targetY}`}
          fill="none"
          stroke="var(--vela-polar-reference)"
          strokeWidth={1.5 * scale}
        />
        <circle
          data-marker="reference"
          cx={box.referenceX}
          cy={box.referenceY}
          r={9 * scale}
          fill="none"
          stroke="var(--vela-polar-reference)"
          strokeWidth={1.5 * scale}
        />
        <g
          data-marker="target"
          fill="none"
          stroke="var(--vela-polar-target)"
          strokeWidth={1.4 * scale}
        >
          <circle cx={m.targetX} cy={m.targetY} r={16 * scale} />
          <path
            d={`M${m.targetX - 30 * scale} ${m.targetY}h${20 * scale}m${20 * scale} 0h${20 * scale}M${m.targetX} ${m.targetY - 30 * scale}v${20 * scale}m0 ${20 * scale}v${20 * scale}`}
          />
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
  noSolution,
}: {
  readonly frame: AlignmentImageFrame
  readonly readState: ReadState
  readonly now: number
  readonly retained: boolean
  readonly noSolution: boolean
}) {
  const [view, setView] = useState<AlignmentImageView>(frame.solution ? 'fit' : 'full')

  const box = frame.solution
    ? alignmentViewport(frame.solution, view === 'native' ? 'full' : view)
    : null

  const age = frame.capturedAt
    ? `${Math.max(0, Math.floor((now - Date.parse(frame.capturedAt)) / 1000))} s ago`
    : 'Age unavailable'

  const status = frame.solution
    ? retained || readState !== 'current'
      ? 'Last known solve'
      : 'Latest solve'
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
    <div className="vela-polar-inspection">
      <div className="vela-polar-inspection-tools" aria-label="Image view">
        {frame.solution && (
          <>
            <Button size="small" aria-pressed={view === 'fit'} onClick={() => setView('fit')}>
              Fit both
            </Button>
            <Button size="small" aria-pressed={view === 'fine'} onClick={() => setView('fine')}>
              Fine · 1′
            </Button>
          </>
        )}
        <Button size="small" aria-pressed={view === 'full'} onClick={() => setView('full')}>
          Full frame
        </Button>
        <Button size="small" aria-pressed={view === 'native'} onClick={() => setView('native')}>
          100%
        </Button>
      </div>
      <p className="vela-polar-inspection-status">
        {status} · {age}
        {readMessages[readState]}
      </p>
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
      <ImageCanvas key={frame.imageUrl} frame={frame} view={view} />
      <p className="vela-polar-inspection-meta">
        {descriptions[view]}
        {box && view !== 'native' && ' · Approximate scale from camera field'}
      </p>
      {frame.solution && view !== 'native' && (
        <div className="vela-polar-inspection-legend">
          <span>
            <i /> Frame reference
          </span>
          <span>
            <i /> Correction target
          </span>
        </div>
      )}
    </div>
  )
}

export function AlignmentImage({
  frame,
  readState,
  now,
  retained,
  noSolution = false,
  openerId,
  onEnlarge,
}: {
  readonly frame: AlignmentImageFrame
  readonly readState: ReadState
  readonly now: number
  readonly retained: boolean
  readonly noSolution?: boolean
  readonly openerId: string
  readonly onEnlarge: (image: ExpandedAlignmentImage) => void
}) {
  return (
    <figure className="vela-polar-image">
      <div className="vela-polar-image-heading">
        <span>{frame.title}</span>
        <Button id={openerId} size="small" onClick={() => onEnlarge({ frame, noSolution })}>
          Enlarge image
        </Button>
      </div>
      <InspectionView
        frame={frame}
        readState={readState}
        now={now}
        retained={retained}
        noSolution={noSolution}
      />
      <figcaption>
        <ExposureTime frame={frame} />
      </figcaption>
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
        <>
          <p className="vela-polar-inspection-time">
            <ExposureTime frame={image.frame} /> · Retained for inspection
          </p>
          <InspectionView
            frame={image.frame}
            readState={readState}
            now={now}
            retained
            noSolution={image.noSolution}
          />
        </>
      )}
    </Dialog>
  )
}
