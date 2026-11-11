import type { Reading } from './Readings.tsx'
import styles from './Readout.module.css'

interface ReadoutProps {
  readonly items: ReadonlyArray<Reading>
}

export function Readout({ items }: ReadoutProps) {
  return (
    <dl className={styles.readout}>
      {items.map(item => (
        <div key={item.label} className={styles.item}>
          <dt className={styles.label}>{item.label}</dt>
          <dd className={styles.value}>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
