import styles from './Readings.module.css'

export interface Reading {
  readonly label: string
  readonly value: string
  readonly attention?: boolean
}

interface ReadingsProps {
  readonly heading?: string
  readonly rows: ReadonlyArray<Reading>
}

export function Readings({ heading, rows }: ReadingsProps) {
  return (
    <section className={styles.readings}>
      {heading === undefined ? null : <h2 className={styles.heading}>{heading}</h2>}

      <dl className={styles.rows}>
        {rows.map(row => (
          <div key={row.label} className={styles.row}>
            <dt className={styles.label}>{row.label}</dt>
            <dd className={row.attention === true ? `${styles.value} ${styles.attention}` : styles.value}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
