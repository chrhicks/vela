import { StubSky } from '../../../stub/StubSky.tsx'
import styles from './FramedSky.module.css'

interface FramedSkyProps {
  readonly seed: number
  readonly angleDegrees: number | undefined
  readonly offset: { readonly eastDegrees: number; readonly northDegrees: number } | undefined
}

const pictureWidthOverHeight = 1.5
const filled = 0.88
const frameDegrees = { width: 3.37, height: 2.25 }

function frameStyle(angleDegrees: number, eastDegrees: number, northDegrees: number) {
  const turn = (angleDegrees * Math.PI) / 180
  const across = Math.abs(Math.cos(turn))
  const along = Math.abs(Math.sin(turn))
  const moved = Math.max(Math.abs(eastDegrees) / frameDegrees.width, Math.abs(northDegrees) / frameDegrees.height)
  const size = (filled / (1 + 2 * moved)) * Math.min(pictureWidthOverHeight / (pictureWidthOverHeight * across + along), 1 / (pictureWidthOverHeight * along + across)) * 100

  return {
    width: `${size}%`,
    height: `${size}%`,
    left: `${50 - (eastDegrees / frameDegrees.width) * size}%`,
    top: `${50 - (northDegrees / frameDegrees.height) * size}%`,
    transform: `translate(-50%, -50%) rotate(${angleDegrees}deg)`,
  }
}

export function FramedSky({ seed, angleDegrees, offset }: FramedSkyProps) {
  return (
    <div className={styles.sky}>
      <StubSky seed={seed} glow="faint" />

      <span className={styles.frame} style={frameStyle(angleDegrees ?? 0, offset?.eastDegrees ?? 0, offset?.northDegrees ?? 0)} />
    </div>
  )
}
