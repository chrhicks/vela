import type { FactCell } from '../../../../state/horizon-view.ts'
import styles from './HorizonFacts.module.css'

interface HorizonFactsProps {
  readonly cells: ReadonlyArray<FactCell>
}

export function HorizonFacts({ cells }: HorizonFactsProps) {
  return (
    <dl className={styles.facts}>
      {cells.map(cell => (
        <div key={cell.label} className={styles.fact}>
          <dt className={styles.label}>{cell.label}</dt>
          <dd className={styles.value}>{cell.value}</dd>
          {cell.note === null ? null : <dd className={styles.note}>{cell.note}</dd>}
        </div>
      ))}
    </dl>
  )
}
