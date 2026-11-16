import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { useNavigate } from 'react-router'

import { skyPositionAt, surveyPixelDegrees } from '../../../../../state/sky-cut.ts'
import { detailTilesPath, type Survey } from '../../../../../state/survey.ts'
import { ActionLink } from '../../../components/ActionLink.tsx'
import { Choices } from '../../../components/Choices.tsx'
import { PageHeader } from '../../../components/PageHeader.tsx'
import { frameDegrees } from './frame.ts'
import styles from './FullSky.module.css'
import { skyPictureOf } from './sky-picture.ts'

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

interface FullSkyProps {
  readonly survey: Survey
  readonly name: string
  readonly raDegrees: number
  readonly decDegrees: number
  readonly angleDegrees: number
  readonly framing: Offset
  readonly facts: ReadonlyArray<string>
  readonly closeTo: string
}

const radians = Math.PI / 180

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

function viewOf(bounds: Bounds, zoom: Zoom, centre: Offset | undefined, props: FullSkyProps): View {
  const degreesPerPixel = zoom === 'fit' ? fitDegreesPerPixel(bounds, props.angleDegrees) : surveyPixelDegrees(props.survey.order, props.survey.tileWidth)

  if (centre !== undefined) return { ...centre, degreesPerPixel }

  const bandMiddle = (bounds.top + bounds.bottom) / 2

  return { eastDegrees: props.framing.eastDegrees, northDegrees: props.framing.northDegrees - (bounds.height / 2 - bandMiddle) * degreesPerPixel, degreesPerPixel }
}

export function FullSky(props: FullSkyProps) {
  const { survey, name, raDegrees, decDegrees, angleDegrees, framing, facts, closeTo } = props
  const navigate = useNavigate()
  const box = useRef<HTMLDivElement>(null)
  const top = useRef<HTMLDivElement>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [bounds, setBounds] = useState<Bounds | undefined>(undefined)
  const [zoom, setZoom] = useState<Zoom>('fit')
  const [centre, setCentre] = useState<Offset | undefined>(undefined)
  const [drawn, setDrawn] = useState<View | undefined>(undefined)
  const drag = useRef<Drag | undefined>(undefined)
  const wanted = useRef<{ readonly key: string; readonly view: View; readonly bounds: Bounds } | undefined>(undefined)
  const cutting = useRef(false)
  const open = useRef(true)

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

  useEffect(
    () => () => {
      open.current = false
    },
    [],
  )

  const view = bounds === undefined ? undefined : viewOf(bounds, zoom, centre, props)
  const key = view === undefined || bounds === undefined ? undefined : [view.eastDegrees, view.northDegrees, view.degreesPerPixel, bounds.width, bounds.height].join(' ')

  useEffect(() => {
    if (view === undefined || bounds === undefined || key === undefined) return

    wanted.current = { key, view, bounds }

    if (cutting.current) return

    cutting.current = true

    const cutNext = async () => {
      for (;;) {
        const next = wanted.current

        if (next === undefined || !open.current) break

        const at = skyPositionAt({ raDegrees, decDegrees }, next.view.eastDegrees, next.view.northDegrees)
        const picture = await skyPictureOf(
          { ...at, widthDegrees: next.view.degreesPerPixel * next.bounds.width, widthPixels: next.bounds.width, heightPixels: next.bounds.height, order: survey.order, tileWidth: survey.tileWidth },
          detailTilesPath,
        )

        if (!open.current) break

        const into = canvas.current

        if (into !== null) {
          into.width = next.bounds.width
          into.height = next.bounds.height
          into.getContext('2d')?.putImageData(picture, 0, 0)
          setDrawn(next.view)
        }

        if (wanted.current?.key === next.key) break
      }

      cutting.current = false
    }

    void cutNext()
  }, [key])

  const press = (event: PointerEvent<HTMLCanvasElement>) => {
    if (view === undefined) return

    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, y: event.clientY, from: view }
  }

  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    const dragging = drag.current

    if (dragging === undefined || view === undefined) return

    setCentre({ eastDegrees: dragging.from.eastDegrees + (event.clientX - dragging.x) * view.degreesPerPixel, northDegrees: dragging.from.northDegrees + (event.clientY - dragging.y) * view.degreesPerPixel })
  }

  const release = () => {
    drag.current = undefined
  }

  const zoomAt = (event: MouseEvent<HTMLCanvasElement>) => {
    if (view === undefined || bounds === undefined) return

    setCentre({ eastDegrees: view.eastDegrees + (bounds.width / 2 - event.clientX) * view.degreesPerPixel, northDegrees: view.northDegrees + (bounds.height / 2 - event.clientY) * view.degreesPerPixel })
    setZoom('full')
  }

  const choose = (chosen: Zoom) => {
    setZoom(chosen)
    if (chosen === 'fit') setCentre(undefined)
  }

  const skyStyle =
    view === undefined || drawn === undefined
      ? undefined
      : {
          transform: `translate(${(view.eastDegrees - drawn.eastDegrees) / view.degreesPerPixel}px, ${(view.northDegrees - drawn.northDegrees) / view.degreesPerPixel}px) scale(${drawn.degreesPerPixel / view.degreesPerPixel})`,
        }

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
        style={skyStyle}
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
        <PageHeader title={name} facts={[...facts, ...(view === undefined ? [] : [arcseconds(view.degreesPerPixel)])]}>
          <ActionLink to={closeTo}>Close</ActionLink>
        </PageHeader>
      </div>

      <div ref={bottom} className={styles.bottom}>
        <p className={styles.credit}>{survey.credit}</p>

        <Choices
          name="Zoom"
          choices={[
            { value: 'fit', label: 'Fit' },
            { value: 'full', label: '1:1' },
          ]}
          chosen={zoom}
          onChoose={choose}
        />
      </div>
    </div>
  )
}
