import { NudgeDirection } from '../../../../state/commands.ts'
import styles from './NudgePad.module.css'

export function NudgePad() {
  return (
    <div className={styles.pad} role="group" aria-label="Nudge">
      <span className={styles.label}>Nudge</span>

      {NudgeDirection.literals.map(direction => (
        <button key={direction} type="button" className={`${styles.key} ${styles[direction]}`} aria-label={`Nudge ${direction}`}>
          {direction}
        </button>
      ))}
    </div>
  )
}
