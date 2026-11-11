import styles from './Statement.module.css'

interface StatementProps {
  readonly size: 'instruction' | 'verdict'
  readonly children: string
}

export function Statement({ size, children }: StatementProps) {
  return <p className={`${styles.statement} ${styles[size]}`}>{children}</p>
}
