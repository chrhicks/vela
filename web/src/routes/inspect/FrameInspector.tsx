import { type PointerEvent, useLayoutEffect, useRef, useState } from 'react'

import { boxAround, type Extent, type Share } from '../../../../state/crop-box.ts'
import { cropAddress, previewAddress, type Frame } from '../../../../state/frames.ts'
import { Caption } from '../../components/Caption.tsx'
import { Picture } from '../../components/Picture.tsx'
import { Statement } from '../../components/Statement.tsx'
import { frameShape } from '../../rig/frame-shape.ts'
import { useAsked } from '../../rig/use-asked.ts'
import styles from './Inspector.module.css'
import { cropNames } from './stub.ts'

interface FrameInspectorProps {
  readonly frame: Pick<Frame, 'night' | 'file'>
}

const middle: Share = { x: 0.5, y: 0.5 }

const places: ReadonlyArray<Share> = [0, 0.5, 1].flatMap(y => [0, 0.5, 1].map(x => ({ x, y })))

function useExtent<Measured extends HTMLElement>(): readonly [(element: Measured | null) => void, Extent | undefined] {
  const [element, setElement] = useState<Measured | null>(null)
  const [extent, setExtent] = useState<Extent | undefined>(undefined)

  useLayoutEffect(() => {
    if (element === null) return

    const measure = () => {
      const { width, height } = element.getBoundingClientRect()

      setExtent({ width, height })
    }
    const watcher = new ResizeObserver(measure)

    watcher.observe(element)

    return () => watcher.disconnect()
  }, [element])

  return [setElement, extent]
}

export function FrameInspector({ frame }: FrameInspectorProps) {
  const [spot, setSpot] = useState<Share>(middle)
  const [shown, setShown] = useState<Share>(middle)
  const [close, closeExtent] = useExtent<HTMLDivElement>()
  const [crop, cropExtent] = useExtent<HTMLLIElement>()
  const answer = useAsked(() => frameShape(frame), `${frame.night}/${frame.file}`, 0)
  const pressed = useRef(false)

  if (answer === undefined) return null

  if (answer === null) return <Statement size="instruction">Vela could not read this frame</Statement>

  const shape = answer
  const boxed = closeExtent === undefined ? undefined : boxAround(shape, closeExtent, spot)
  const closeUp = closeExtent === undefined ? undefined : boxAround(shape, closeExtent, shown)

  const spotAt = (event: PointerEvent<HTMLDivElement>): Share => {
    const whole = event.currentTarget.getBoundingClientRect()

    return { x: (event.clientX - whole.left) / whole.width, y: (event.clientY - whole.top) / whole.height }
  }

  const press = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    pressed.current = true
    setSpot(spotAt(event))
  }

  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (pressed.current) setSpot(spotAt(event))
  }

  const release = (event: PointerEvent<HTMLDivElement>) => {
    if (!pressed.current) return

    pressed.current = false
    setShown(spotAt(event))
  }

  return (
    <div className={styles.inspector}>
      <div className={styles.whole}>
        <Picture label="Whole frame" detail={`${shape.width} × ${shape.height}`}>
          <div className={styles.sky} onPointerDown={press} onPointerMove={move} onPointerUp={release} onPointerCancel={release}>
            <img src={previewAddress(frame)} alt="The whole frame" draggable={false} />

            {boxed === undefined ? null : (
              <span
                className={styles.box}
                style={{
                  left: `${(boxed.x / shape.width) * 100}%`,
                  top: `${(boxed.y / shape.height) * 100}%`,
                  width: `${(boxed.width / shape.width) * 100}%`,
                  height: `${(boxed.height / shape.height) * 100}%`,
                }}
              />
            )}
          </div>
        </Picture>
      </div>

      <div className={styles.close}>
        <Picture label="At 100 %" detail="The box on the left">
          <div ref={close} className={styles.full}>
            {closeUp === undefined ? null : <img src={cropAddress(frame, closeUp)} alt="The box at full size" width={closeUp.width} height={closeUp.height} />}
          </div>
        </Picture>
      </div>

      <div className={styles.field}>
        <div className={styles.fieldCaption}>
          <Caption>Corners, edges and centre</Caption>
          <Caption>At 100 %</Caption>
        </div>

        <ul className={styles.crops}>
          {places.map((place, index) => {
            const box = cropExtent === undefined ? undefined : boxAround(shape, cropExtent, place)

            return (
              <li key={cropNames[index]} ref={index === 0 ? crop : undefined} className={`${styles.crop} ${styles.full}`} aria-label={cropNames[index]}>
                {box === undefined ? null : <img src={cropAddress(frame, box)} alt="" width={box.width} height={box.height} />}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
