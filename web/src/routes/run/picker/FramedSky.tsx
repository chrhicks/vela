import { StubSky } from '../../../stub/StubSky.tsx'
import styles from './FramedSky.module.css'

interface FramedSkyProps {
  readonly seed: number
  readonly angleDegrees: number | undefined
}

const pictureWidthOverHeight = 1.5
const filled = 0.88

function frameStyle(angleDegrees: number) {
  const turn = (angleDegrees * Math.PI) / 180
  const across = Math.abs(Math.cos(turn))
  const along = Math.abs(Math.sin(turn))
  const size = filled * Math.min(pictureWidthOverHeight / (pictureWidthOverHeight * across + along), 1 / (pictureWidthOverHeight * along + across)) * 100

  return { width: `${size}%`, height: `${size}%`, transform: `translate(-50%, -50%) rotate(${-angleDegrees}deg)` }
}

export function FramedSky({ seed, angleDegrees }: FramedSkyProps) {
  return (
    <div className={styles.sky}>
      <StubSky seed={seed} glow="faint" />

      <span className={styles.frame} style={frameStyle(angleDegrees ?? 0)} />
    </div>
  )
}
