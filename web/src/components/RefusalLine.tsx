import type { Refusal } from '../../../state/commands.ts'
import { refusalWords } from '../rig/words.ts'
import styles from './RefusalLine.module.css'

export function RefusalLine({ refusal }: { readonly refusal: Refusal }) {
  const { happened, toDo } = refusalWords(refusal)

  return (
    <span className={styles.refusal}>
      <span>{happened}</span>
      {toDo === undefined ? null : <span className={styles.toDo}>{toDo}</span>}
    </span>
  )
}
