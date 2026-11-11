import type { ReactNode } from 'react'

import { Facts } from './Facts.tsx'
import styles from './Alert.module.css'

interface AlertProps {
  readonly title: string
  readonly facts: ReadonlyArray<string>
  readonly children?: ReactNode
}

export function Alert({ title, facts, children }: AlertProps) {
  return (
    <section className={styles.alert} role="alert">
      <h2 className={styles.title}>{title}</h2>

      <Facts items={facts} tone="attention" />

      {children === undefined ? null : <div className={styles.fixes}>{children}</div>}
    </section>
  )
}
