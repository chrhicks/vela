import styles from './Checks.module.css'

export interface Check {
  readonly label: string
  readonly value: string
  readonly verdict: string
  readonly attention?: boolean
}

interface ChecksProps {
  readonly checks: ReadonlyArray<Check>
}

export function Checks({ checks }: ChecksProps) {
  return (
    <dl className={styles.checks}>
      {checks.map(check => (
        <div key={check.label} className={styles.check}>
          <dt className={styles.label}>{check.label}</dt>
          <dd className={styles.value}>{check.value}</dd>
          <dd className={check.attention === true ? `${styles.verdict} ${styles.attention}` : styles.verdict}>{check.verdict}</dd>
        </div>
      ))}
    </dl>
  )
}
