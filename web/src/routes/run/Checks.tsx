import styles from './Checks.module.css'
import type { Check } from './stub.ts'

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
          <dd className={styles.verdict}>{check.verdict}</dd>
        </div>
      ))}
    </dl>
  )
}
