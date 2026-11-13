import type { Answer } from '../rig/commands.ts'
import { clockSeconds } from '../rig/clock.ts'
import { doneWords, refusalWords } from '../rig/words.ts'
import styles from './PressLine.module.css'

export interface Pressed {
  readonly answer: Answer
  readonly at: number
}

export function PressLine({ pressed }: { readonly pressed: Pressed | undefined }) {
  if (pressed === undefined) return <p className={styles.line} aria-live="polite" />

  const { answer, at } = pressed
  const { happened, toDo } = answer.result === 'done' ? doneWords(answer.done) : refusalWords(answer.refusal)

  return (
    <p className={answer.result === 'done' ? styles.line : `${styles.line} ${styles.refused}`} aria-live="polite">
      <span>{happened}</span>
      {toDo === undefined ? null : <span className={styles.detail}>{toDo}</span>}
      <span className={styles.detail}>{clockSeconds(at)}</span>
    </p>
  )
}
