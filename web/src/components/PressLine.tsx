import type { Answer } from '../rig/commands.ts'
import { clockSeconds } from '../rig/clock.ts'
import { doneWords, refusalWords, type RefusalWords } from '../rig/words.ts'
import styles from './PressLine.module.css'

export interface Pressed {
  readonly answer: Answer
  readonly at: number
}

export interface Said {
  readonly words: RefusalWords
  readonly troubled: boolean
  readonly at: number
}

export const saidOf = ({ answer, at }: Pressed): Said =>
  answer.result === 'done' ? { words: doneWords(answer.done), troubled: false, at } : { words: refusalWords(answer.refusal), troubled: true, at }

export const latestSaid = (...said: ReadonlyArray<Said | undefined>): Said | undefined =>
  said.reduce<Said | undefined>((latest, next) => (next !== undefined && (latest === undefined || next.at >= latest.at) ? next : latest), undefined)

export function PressLine({ said }: { readonly said: Said | undefined }) {
  if (said === undefined) return <p className={styles.line} aria-live="polite" />

  const { words, troubled, at } = said

  return (
    <p className={troubled ? `${styles.line} ${styles.refused}` : styles.line} aria-live="polite">
      <span>{words.happened}</span>
      {words.toDo === undefined ? null : <span className={styles.detail}>{words.toDo}</span>}
      <span className={styles.detail}>{clockSeconds(at)}</span>
    </p>
  )
}
