import styles from './NudgePad.module.css'

const directions = ['N', 'S', 'E', 'W'] as const

export function NudgePad() {
  return (
    <div className={styles.pad} role="group" aria-label="Nudge">
      <span className={styles.label}>Nudge</span>

      {directions.map(direction => (
        <button key={direction} type="button" className={`${styles.key} ${styles[direction]}`} aria-label={`Nudge ${direction}`}>
          {direction}
        </button>
      ))}
    </div>
  )
}
