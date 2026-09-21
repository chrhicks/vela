import { useState } from 'react'
import { Button } from './Button'
import { Dialog } from './Dialog'

const starField = new URL('./fixtures/capture-star-field.png', import.meta.url).href

// Illustrative image geometry, not a plate solution for the bundled simulator image.
const frame = {
  width: 1600,
  height: 1200,
  arcsecPerPixel: 2,
  x: 800,
  y: 600,
}

export const alignmentInspectionFixtures = {
  'large-error': {
    x: 580,
    y: 478,
    total: '8′ 23″',
    azimuth: '7′ 20″',
    altitude: '4′ 04″',
  },
  'near-aligned': {
    x: 794.5,
    y: 595.5,
    total: '14″',
    azimuth: '11″',
    altitude: '9″',
  },
  'outside-image': {
    x: -220,
    y: 356,
    total: '34′ 58″',
    azimuth: '34′',
    altitude: '8′ 08″',
  },
}

type Target = (typeof alignmentInspectionFixtures)['large-error']

type ImageView = 'fit' | 'fine' | 'full' | 'native'

const viewDescriptions: Record<ImageView, string> = {
  native: '100% · 1 image pixel = 1 CSS pixel · Scroll to inspect · Overlay hidden',
  fine: '1′ vertical field · Midpoint of reference and target',
  fit: 'Fit both · Padded context, 4′ minimum vertical field',
  full: 'Full frame · 53.3′ × 40′',
}

function ImageCanvas({
  target,
  view,
}: {
  readonly target: Target | undefined
  readonly view: ImageView
}) {
  if (view === 'native')
    return (
      <div
        className="vela-polar-native"
        tabIndex={0}
        role="region"
        aria-label="Native image, scroll to inspect"
      >
        <img
          src={starField}
          width={frame.width}
          height={frame.height}
          alt="Same illustrative exposure at one image pixel per CSS pixel"
        />
      </div>
    )

  const full = !target || view === 'full'

  const height = full
    ? frame.height
    : view === 'fine'
      ? 30
      : Math.max(
          120,
          Math.abs(target.y - frame.y) * 1.5 + 60,
          (Math.abs(target.x - frame.x) * 1.5 + 96) / 1.6,
        )

  const width = full ? frame.width : height * 1.6
  const centerX = full ? frame.width / 2 : (frame.x + target.x) / 2
  const centerY = full ? frame.height / 2 : (frame.y + target.y) / 2
  const left = centerX - width / 2
  const top = centerY - height / 2
  const scale = width / 640
  const barPixels = width / 5
  const barArcsec = barPixels * frame.arcsecPerPixel
  const barLabel = barArcsec < 60 ? `${Math.round(barArcsec)}″` : `${(barArcsec / 60).toFixed(1)}′`

  return (
    <div className="vela-polar-image-canvas">
      <svg
        viewBox={`${left} ${top} ${width} ${height}`}
        role="img"
        aria-label={
          target
            ? 'Illustrative exposure with frame reference and correction target'
            : 'Full baseline exposure, no alignment solution'
        }
      >
        <image href={starField} width={frame.width} height={frame.height} />
        {target && (
          <>
            <path
              d={`M${frame.x} ${frame.y}L${target.x} ${target.y}`}
              fill="none"
              stroke="var(--vela-polar-reference)"
              strokeWidth={1.5 * scale}
            />
            <circle
              data-marker="reference"
              cx={frame.x}
              cy={frame.y}
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
              <circle cx={target.x} cy={target.y} r={16 * scale} />
              <path
                d={`M${target.x - 30 * scale} ${target.y}h${20 * scale}m${20 * scale} 0h${20 * scale}M${target.x} ${target.y - 30 * scale}v${20 * scale}m0 ${20 * scale}v${20 * scale}`}
              />
            </g>
          </>
        )}
      </svg>
      <div className="vela-polar-angular-scale" aria-label={`Angular scale ${barLabel}`}>
        <span>{barLabel}</span>
        <i />
      </div>
    </div>
  )
}

function InspectionView({
  target,
  status,
}: {
  readonly target: Target | undefined
  readonly status: string
}) {
  const [view, setView] = useState<ImageView>(target ? 'fit' : 'full')

  const outside =
    target && (target.x < 0 || target.x > frame.width || target.y < 0 || target.y > frame.height)

  const fineClips =
    target && (Math.abs(target.x - frame.x) > 40 || Math.abs(target.y - frame.y) > 22)

  return (
    <div className="vela-polar-inspection">
      <div className="vela-polar-inspection-tools" aria-label="Image view">
        {target && (
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
      <p className="vela-polar-inspection-status">{status}</p>
      {outside && (
        <p className="vela-polar-inspection-note">
          Target outside captured image · Blank area has no image data.
        </p>
      )}
      {view === 'fine' && fineClips && (
        <p className="vela-polar-inspection-note">
          Markers outside this fine view. Use Fit both to see the correction.
        </p>
      )}
      <ImageCanvas target={target} view={view} />
      <p className="vela-polar-inspection-meta">
        {viewDescriptions[view]}
        {view !== 'native' && ' · Illustrative angular scale'}
      </p>
      {target && view !== 'native' && (
        <div className="vela-polar-inspection-legend">
          <span>
            <i />
            {' Frame reference'}
          </span>
          <span>
            <i />
            {' Correction target'}
          </span>
        </div>
      )}
    </div>
  )
}

export function AlignmentImageInspection({
  target,
  title,
  status,
}: {
  readonly target?: Target
  readonly title: string
  readonly status: string
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <figure className="vela-polar-image">
      <div className="vela-polar-image-heading">
        <span>{title}</span>
        <Button size="small" onClick={() => setExpanded(true)}>
          Enlarge image
        </Button>
      </div>
      <InspectionView target={target} status={status} />
      <figcaption>
        {'Exposure started '}
        <time dateTime="2026-09-14T20:25:49">8:25:49 PM</time>
        {' · Fixture'}
      </figcaption>
      <Dialog
        open={expanded}
        title={title}
        description="Same exposure · Started 8:25:49 PM · Inspection takes no new image."
        onDismiss={() => setExpanded(false)}
        className="vela-polar-inspection-dialog"
      >
        <InspectionView target={target} status={status} />
      </Dialog>
    </figure>
  )
}
