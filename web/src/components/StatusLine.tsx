import type { Reading } from './Readings.tsx'
import styles from './StatusLine.module.css'

interface StatusLineProps {
  readonly items: ReadonlyArray<Reading>
}

export function StatusLine({ items }: StatusLineProps) {
  return (
    <dl className={styles.line}>
      {items.map(item => (
        <div key={item.label} className={styles.item}>
          <dt className={styles.label}>{item.label}</dt>
          <dd className={item.attention === true ? `${styles.value} ${styles.attention}` : styles.value}>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
