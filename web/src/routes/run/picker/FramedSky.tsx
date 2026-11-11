import { StubSky } from '../../../stub/StubSky.tsx'
import styles from './FramedSky.module.css'

interface FramedSkyProps {
  readonly seed: number
}

export function FramedSky({ seed }: FramedSkyProps) {
  return (
    <div className={styles.sky}>
      <StubSky seed={seed} glow="faint" />

      <span className={styles.frame} />
    </div>
  )
}
