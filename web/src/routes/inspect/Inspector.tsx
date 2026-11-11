import { type MouseEvent, useState } from 'react'

import { Caption } from '../../components/Caption.tsx'
import { Picture } from '../../components/Picture.tsx'
import { StubSky } from '../../stub/StubSky.tsx'
import styles from './Inspector.module.css'
import { cropNames } from './stub.ts'

interface InspectorProps {
  readonly seed: number
  readonly glow: 'faint' | 'bright'
}

interface Spot {
  readonly x: number
  readonly y: number
}

const boxShare = 0.15

const within = (share: number) => Math.min(1 - boxShare / 2, Math.max(boxShare / 2, share))

export function Inspector({ seed, glow }: InspectorProps) {
  const [spot, setSpot] = useState<Spot>({ x: 0.72, y: 0.34 })

  function moveBox(event: MouseEvent<HTMLDivElement>) {
    const frame = event.currentTarget.getBoundingClientRect()

    setSpot({
      x: within((event.clientX - frame.left) / frame.width),
      y: within((event.clientY - frame.top) / frame.height),
    })
  }

  return (
    <div className={styles.inspector}>
      <div className={styles.whole}>
        <Picture label="Whole frame" detail="">
          <div className={styles.sky} onClick={moveBox}>
            <StubSky seed={seed} glow={glow} />

            <span
              className={styles.box}
              style={{
                left: `${(spot.x - boxShare / 2) * 100}%`,
                top: `${(spot.y - boxShare / 2) * 100}%`,
                width: `${boxShare * 100}%`,
                height: `${boxShare * 100}%`,
              }}
            />
          </div>
        </Picture>
      </div>

      <div className={styles.close}>
        <Picture label="At 100 %" detail="">
          <StubSky seed={seed + Math.round(spot.x * 100) + Math.round(spot.y * 1000)} glow={glow} view="close" />
        </Picture>
      </div>

      <div className={styles.field}>
        <div className={styles.fieldCaption}>
          <Caption>Corners, edges and centre</Caption>
          <Caption>100 %</Caption>
        </div>

        <ul className={styles.crops}>
          {cropNames.map((name, index) => (
            <li key={name} className={styles.crop} aria-label={name}>
              <StubSky seed={seed * 31 + index} glow={glow} view="close" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
