import { Result } from 'effect'
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { useNavigate } from 'react-router'

import { surveyPixelDegrees } from '../../../../../state/sky-cut.ts'
import { detailTilesPath, surveyTilesPath, type Survey } from '../../../../../state/survey.ts'
import { ActionLink } from '../../../components/ActionLink.tsx'
import { Choices } from '../../../components/Choices.tsx'
import { PageHeader } from '../../../components/PageHeader.tsx'
import { Statement } from '../../../components/Statement.tsx'
import { useLink } from '../../../rig/store.ts'
import { frameDegrees } from './frame.ts'
import styles from './FullSky.module.css'
import { makeSkyDrawing, type SkyDrawing } from './sky-drawing.ts'

interface Offset {
  readonly eastDegrees: number
  readonly northDegrees: number
}

interface View extends Offset {
  readonly degreesPerPixel: number
}

interface Bounds {
  readonly width: number
  readonly height: number
  readonly side: number
  readonly top: number
  readonly bottom: number
}

interface Drag {
  readonly x: number
  readonly y: number
  readonly from: Offset
}

type Zoom = 'fit' | 'full'

interface Held {
  readonly centre: Offset | undefined
  readonly degreesPerPixel: number | undefined
}

interface Range {
  readonly finest: number
  readonly widest: number
}

interface Glide {
  readonly frame: number
  readonly aim: number
}

interface Shown {
  readonly view: View
  readonly bounds: Bounds
}

const easedOut = (progress: number) => 1 - (1 - progress) ** 3

const scaleBetween = (from: number, to: number, progress: number) => from * (to / from) ** progress

const between = (from: number, to: number, progress: number) => from + (to - from) * progress

const unheld: Held = { centre: undefined, degreesPerPixel: undefined }

interface FullSkyProps {
  readonly coarse: Survey | null
  readonly detail: Survey
  readonly name: string
  readonly raDegrees: number
  readonly decDegrees: number
  readonly angleDegrees: number
  readonly framing: Offset
  readonly facts: ReadonlyArray<string>
  readonly closeTo: string
}

const radians = Math.PI / 180

const pixelDegrees = (survey: Survey) => surveyPixelDegrees(survey.order, survey.tileWidth)

const arcseconds = (degrees: number) => {
  const seconds = degrees * 3600

  return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}″ a pixel`
}

function fitDegreesPerPixel(bounds: Bounds, angleDegrees: number) {
  const cos = Math.abs(Math.cos(angleDegrees * radians))
  const sin = Math.abs(Math.sin(angleDegrees * radians))
  const width = frameDegrees.width * cos + frameDegrees.height * sin
  const height = frameDegrees.width * sin + frameDegrees.height * cos

  return Math.max(width / (bounds.width - 2 * bounds.side), height / (bounds.bottom - bounds.top))
}

function viewOf(bounds: Bounds, held: Held, props: FullSkyProps): View {
  const degreesPerPixel = held.degreesPerPixel ?? fitDegreesPerPixel(bounds, props.angleDegrees)

  if (held.centre !== undefined) return { ...held.centre, degreesPerPixel }

  const bandMiddle = (bounds.top + bounds.bottom) / 2

  return { eastDegrees: props.framing.eastDegrees, northDegrees: props.framing.northDegrees - (bounds.height / 2 - bandMiddle) * degreesPerPixel, degreesPerPixel }
}

export function FullSky(props: FullSkyProps) {
  const { coarse, detail, name, raDegrees, decDegrees, angleDegrees, framing, facts, closeTo } = props
  const navigate = useNavigate()
  const box = useRef<HTMLDivElement>(null)
  const top = useRef<HTMLDivElement>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [bounds, setBounds] = useState<Bounds | undefined>(undefined)
  const [held, setHeld] = useState<Held>(unheld)
  const picker = useLink().picker
  const wheelPixelsPerDoubling = picker?.wheelPixelsPerDoubling
  const zoomGlideMs = picker?.zoomGlideMs
  const [undrawable, setUndrawable] = useState<string | undefined>(undefined)
  const [missing, setMissing] = useState(0)
  const drag = useRef<Drag | undefined>(undefined)
  const shown = useRef<Shown | undefined>(undefined)
  const glide = useRef<Glide | undefined>(undefined)
  const drawing = useRef<SkyDrawing | undefined>(undefined)

  useLayoutEffect(() => {
    const measure = () => {
      const whole = box.current?.getBoundingClientRect()
      const above = top.current?.getBoundingClientRect()
      const below = bottom.current?.getBoundingClientRect()

      if (whole === undefined || above === undefined || below === undefined) return

      setBounds({ width: Math.round(whole.width), height: Math.round(whole.height), side: Number.parseFloat(getComputedStyle(top.current!).paddingLeft), top: above.bottom - whole.top, bottom: below.top - whole.top })
    }
    const watcher = new ResizeObserver(measure)

    if (box.current !== null) watcher.observe(box.current)

    return () => watcher.disconnect()
  }, [])

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') navigate(closeTo)
    }

    window.addEventListener('keydown', close)

    return () => window.removeEventListener('keydown', close)
  }, [navigate, closeTo])

  useLayoutEffect(() => {
    if (canvas.current === null) return

    const made = makeSkyDrawing(canvas.current, { raDegrees, decDegrees }, setMissing)

    if (Result.isFailure(made)) {
      setUndrawable(made.failure.reason)

      return
    }

    drawing.current = made.success

    return () => {
      made.success.close()
      drawing.current = undefined
    }
  }, [raDegrees, decDegrees])

  const view = bounds === undefined ? undefined : viewOf(bounds, held, props)
  const range: Range | undefined = bounds === undefined ? undefined : { finest: pixelDegrees(detail), widest: Math.max(fitDegreesPerPixel(bounds, angleDegrees), coarse === null ? 0 : pixelDegrees(coarse)) }

  shown.current = view === undefined || bounds === undefined ? undefined : { view, bounds }

  const stopGlide = () => {
    if (glide.current !== undefined) cancelAnimationFrame(glide.current.frame)

    glide.current = undefined
  }

  const glideTo = (aim: number, heldAt: (progress: number) => Held, settled: Held) => {
    stopGlide()

    if (zoomGlideMs === undefined || zoomGlideMs <= 0) return setHeld(settled)

    const began = performance.now()
    const step = (now: number) => {
      const progress = (now - began) / zoomGlideMs

      if (progress >= 1) {
        glide.current = undefined

        return setHeld(settled)
      }

      setHeld(heldAt(easedOut(Math.max(0, progress))))
      glide.current = { aim, frame: requestAnimationFrame(step) }
    }

    glide.current = { aim, frame: requestAnimationFrame(step) }
  }

  const zoomAbout = (x: number, y: number, aim: number) => {
    if (shown.current === undefined) return

    const { view: from, bounds: within } = shown.current
    const left = within.width / 2 - x
    const up = within.height / 2 - y
    const east = from.eastDegrees + left * from.degreesPerPixel
    const north = from.northDegrees + up * from.degreesPerPixel
    const heldWith = (degreesPerPixel: number): Held => ({ centre: { eastDegrees: east - left * degreesPerPixel, northDegrees: north - up * degreesPerPixel }, degreesPerPixel })

    glideTo(aim, progress => heldWith(scaleBetween(from.degreesPerPixel, aim, progress)), heldWith(aim))
  }

  const fit = () => {
    if (shown.current === undefined) return

    const { view: from, bounds: within } = shown.current
    const to = viewOf(within, unheld, props)

    glideTo(
      to.degreesPerPixel,
      progress => ({
        centre: { eastDegrees: between(from.eastDegrees, to.eastDegrees, progress), northDegrees: between(from.northDegrees, to.northDegrees, progress) },
        degreesPerPixel: scaleBetween(from.degreesPerPixel, to.degreesPerPixel, progress),
      }),
      unheld,
    )
  }

  useEffect(() => stopGlide, [])

  useEffect(() => {
    const sky = canvas.current

    if (sky === null || wheelPixelsPerDoubling === undefined || range === undefined) return

    const turned = (event: WheelEvent) => {
      event.preventDefault()

      const from = glide.current?.aim ?? shown.current?.view.degreesPerPixel

      if (from !== undefined) zoomAbout(event.clientX, event.clientY, Math.min(range.widest, Math.max(range.finest, from * 2 ** (event.deltaY / wheelPixelsPerDoubling))))
    }

    sky.addEventListener('wheel', turned, { passive: false })

    return () => sky.removeEventListener('wheel', turned)
  }, [wheelPixelsPerDoubling, zoomGlideMs, range?.finest, range?.widest])

  const fine = view !== undefined && (coarse === null || view.degreesPerPixel ** 2 < pixelDegrees(coarse) * pixelDegrees(detail))
  const key = view === undefined || bounds === undefined ? undefined : [view.eastDegrees, view.northDegrees, view.degreesPerPixel, bounds.width, bounds.height, fine].join(' ')

  useLayoutEffect(() => {
    if (view === undefined || bounds === undefined) return

    drawing.current?.show({
      ...view,
      widthPixels: bounds.width,
      heightPixels: bounds.height,
      layers: [...(coarse === null ? [] : [{ survey: coarse, tilesPath: surveyTilesPath }]), ...(fine ? [{ survey: detail, tilesPath: detailTilesPath }] : [])],
    })
  }, [key, coarse, detail])

  const press = (event: PointerEvent<HTMLCanvasElement>) => {
    if (view === undefined) return

    stopGlide()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, y: event.clientY, from: view }
  }

  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    const dragging = drag.current

    if (dragging === undefined || view === undefined) return

    setHeld({ centre: { eastDegrees: dragging.from.eastDegrees + (event.clientX - dragging.x) * view.degreesPerPixel, northDegrees: dragging.from.northDegrees + (event.clientY - dragging.y) * view.degreesPerPixel }, degreesPerPixel: view.degreesPerPixel })
  }

  const release = () => {
    drag.current = undefined
  }

  const zoomAt = (event: MouseEvent<HTMLCanvasElement>) => zoomAbout(event.clientX, event.clientY, pixelDegrees(detail))

  const choose = (chosen: Zoom) => (chosen === 'fit' ? fit() : shown.current === undefined ? undefined : zoomAbout(shown.current.bounds.width / 2, shown.current.bounds.height / 2, pixelDegrees(detail)))

  const chosen: Zoom | undefined = held.degreesPerPixel === undefined ? 'fit' : held.degreesPerPixel === pixelDegrees(detail) ? 'full' : undefined

  const frameStyle =
    view === undefined || bounds === undefined
      ? undefined
      : {
          width: `${frameDegrees.width / view.degreesPerPixel}px`,
          height: `${frameDegrees.height / view.degreesPerPixel}px`,
          left: `${bounds.width / 2 - (framing.eastDegrees - view.eastDegrees) / view.degreesPerPixel}px`,
          top: `${bounds.height / 2 - (framing.northDegrees - view.northDegrees) / view.degreesPerPixel}px`,
          transform: `translate(-50%, -50%) rotate(${angleDegrees}deg)`,
        }

  return (
    <div ref={box} className={styles.full}>
      <canvas
        ref={canvas}
        className={styles.sky}
        role="img"
        aria-label={`The sky around ${name}, north up and east to the left`}
        onPointerDown={press}
        onPointerMove={move}
        onPointerUp={release}
        onPointerCancel={release}
        onDoubleClick={zoomAt}
      />

      {frameStyle === undefined ? null : <span className={styles.frame} style={frameStyle} />}

      <div ref={top} className={styles.top}>
        <PageHeader title={name} facts={[...facts, ...(view === undefined ? [] : [arcseconds(view.degreesPerPixel)]), ...(missing === 0 ? [] : [`${missing} tiles missing`])]}>
          <ActionLink to={closeTo}>Close</ActionLink>
        </PageHeader>

        {undrawable === undefined ? null : <Statement size="instruction">{`Cannot draw the sky: ${undrawable}`}</Statement>}
      </div>

      <div ref={bottom} className={styles.bottom}>
        <p className={styles.credit}>{detail.credit}</p>

        <Choices
          name="Zoom"
          choices={[
            { value: 'fit', label: 'Fit' },
            { value: 'full', label: '1:1' },
          ]}
          chosen={chosen}
          onChoose={choose}
        />
      </div>
    </div>
  )
}
