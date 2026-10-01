import { useEffect, useRef, useState } from 'react'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { Appearance, type AppearancePreference } from './Appearance'

const starField = new URL('./fixtures/capture-star-field.png', import.meta.url)
  .href

// Illustrative image geometry, not a plate solution for the bundled simulator image.
const frame = {
  width: 1600,
  height: 1200,
  arcsecPerPixel: 2,
  x: 799.5,
  y: 599.5,
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
    x: 811,
    y: 584.5,
    total: '38″',
    azimuth: '23″',
    altitude: '30″',
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
  native:
    '100% · 1 image pixel = 1 CSS pixel · Scroll to inspect · Overlay hidden',
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
  const canvas = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ width: 640, height: 400 })
  useEffect(() => {
    const element = canvas.current

    if (!element) return

    const observer = new ResizeObserver(() => {
      const box = element.getBoundingClientRect()
      setSize({ width: box.width, height: box.height })
    })

    observer.observe(element)

    return () => observer.disconnect()
  }, [view])

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

  // Glyphs keep their CSS-pixel size while the measured viewport changes.
  const scale = Math.max(
    width / Math.max(size.width, 1),
    height / Math.max(size.height, 1),
  )

  const barPixels = width / 5
  const barArcsec = barPixels * frame.arcsecPerPixel

  const barLabel =
    barArcsec < 60
      ? `${Math.round(barArcsec)}″`
      : `${(barArcsec / 60).toFixed(1)}′`

  return (
    <div className="vela-polar-image-canvas">
      <svg
        ref={canvas}
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
              stroke="var(--vela-polar-target)"
              strokeWidth={2 * scale}
            />
            <circle
              data-marker="reference"
              cx={frame.x}
              cy={frame.y}
              r={8 * scale}
              fill="none"
              stroke="var(--vela-polar-reference)"
              strokeWidth={scale}
            />
            <path
              data-marker="reference-crosshair"
              d={`M${frame.x - 18 * scale} ${frame.y}h${12 * scale}m${12 * scale} 0h${12 * scale}M${frame.x} ${frame.y - 18 * scale}v${12 * scale}m0 ${12 * scale}v${12 * scale}`}
              fill="none"
              stroke="var(--vela-polar-reference)"
              strokeWidth={2 * scale}
            />
            <circle
              data-marker="target"
              cx={target.x}
              cy={target.y}
              r={13 * scale}
              fill="none"
              stroke="var(--vela-polar-target)"
              strokeWidth={2 * scale}
            />
            <circle
              cx={target.x}
              cy={target.y}
              r={3 * scale}
              fill="var(--vela-polar-target)"
            />
          </>
        )}
      </svg>
      <div
        hidden={!target}
        className="vela-polar-angular-scale"
        aria-label={`Angular scale ${barLabel}`}
      >
        <span>{barLabel}</span>
        <i />
      </div>
    </div>
  )
}

function InspectionView({
  target,
  status,
  expanded = false,
  onEnlarge,
}: {
  readonly target: Target | undefined
  readonly status: string
  readonly expanded?: boolean
  readonly onEnlarge?: () => void
}) {
  const [view, setView] = useState<ImageView>(target ? 'fit' : 'full')

  const outside =
    target &&
    (target.x < 0 ||
      target.x > frame.width ||
      target.y < 0 ||
      target.y > frame.height)

  const fineClips =
    target &&
    (Math.abs(target.x - frame.x) > 40 || Math.abs(target.y - frame.y) > 22)

  return (
    <div
      className="vela-polar-inspection"
      data-expanded={expanded || undefined}
    >
      <div className="vela-polar-image-opening">
        <ImageCanvas target={target} view={view} />
        {!expanded && (
          <button
            className="vela-polar-enlarge"
            aria-label="Enlarge image"
            onClick={onEnlarge}
          >
            ⤢
          </button>
        )}
      </div>
      <p className="vela-polar-inspection-status">{status}</p>
      {target && view !== 'native' && (
        <div className="vela-polar-inspection-legend">
          <span>Crosshair: optical center</span>
          <span>Ring: correction target</span>
        </div>
      )}
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
      <div className="vela-polar-inspection-tools" aria-label="Image view">
        {target && (
          <>
            <Button
              aria-pressed={view === 'fit'}
              onClick={() => setView('fit')}
            >
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
          <Button
            aria-pressed={view === 'native'}
            onClick={() => setView('native')}
          >
            100%
          </Button>
        )}
      </div>
      {expanded && (
        <>
          <p className="vela-polar-inspection-meta">
            {viewDescriptions[view]}
            {target && view !== 'native' && ' · Illustrative angular scale'}
          </p>
          <p>
            Exposure started{' '}
            <time dateTime="2026-09-30T21:02:14">21:02:14</time> · Fixture,
            camera-reported start
          </p>
        </>
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
      <InspectionView
        target={target}
        status={status}
        onEnlarge={() => setExpanded(true)}
      />
      <Dialog
        open={expanded}
        title={title}
        description="Same exposure · Started 21:02:14 · Inspection takes no new image."
        onDismiss={() => setExpanded(false)}
        className="vela-polar-inspection-dialog"
      >
        <InspectionView target={target} status={status} expanded />
      </Dialog>
    </figure>
  )
}

/** Workshop composition only. The application owns navigation and appearance persistence. */
export function PreparationSpecimenHeader() {
  const root = useRef<HTMLElement>(null)
  const [open, setOpen] = useState(false)
  const [preference, setPreference] = useState<AppearancePreference>('system')
  const [mode, setMode] = useState<'light' | 'dark'>('light')
  useEffect(() => {
    const surface = root.current?.closest('[data-mode]')

    if (!surface) return

    const read = () =>
      setMode(surface.getAttribute('data-mode') === 'dark' ? 'dark' : 'light')

    read()
    const observer = new MutationObserver(read)
    observer.observe(surface, {
      attributes: true,
      attributeFilter: ['data-mode'],
    })

    return () => observer.disconnect()
  }, [])

  return (
    <header className="vela-preparation-shell" ref={root}>
      <strong className="vela-preparation-wordmark">vela</strong>
      <nav aria-label="Example navigation">
        <a
          href="#tonight"
          onClick={(event) => event.preventDefault()}
          aria-current="page"
        >
          <span className="vela-preparation-back">← </span>Tonight
        </a>
        <a href="#explore" onClick={(event) => event.preventDefault()}>
          Explore the sky
        </a>
        <a href="#photographs" onClick={(event) => event.preventDefault()}>
          Photographs
        </a>
      </nav>
      <span className="vela-preparation-connected">● Connected</span>
      <span className="vela-preparation-rig">
        Askar FRA 400<span>⌄</span>
      </span>
      <Appearance
        open={open}
        onOpenChange={setOpen}
        value={preference}
        onValueChange={setPreference}
        systemMode={mode}
        persistence="saved"
      />
    </header>
  )
}
