import styles from './StubSky.module.css'
import { starfield } from './series.ts'

interface StubSkyProps {
  readonly seed: number
  readonly glow: 'faint' | 'bright'
}

export function StubSky({ seed, glow }: StubSkyProps) {
  return (
    <svg viewBox="0 0 300 200" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Placeholder picture of the sky">
      <ellipse className={styles[glow]} cx="150" cy="105" rx="46" ry="34" />
      <ellipse className={styles[glow]} cx="150" cy="105" rx="24" ry="17" />

      {starfield(seed, 70).map(star => (
        <circle key={`${star.x} ${star.y}`} className={styles.star} cx={star.x} cy={star.y} r={star.size} />
      ))}
    </svg>
  )
}
