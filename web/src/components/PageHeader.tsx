import type { ReactNode } from 'react'

import { Facts } from './Facts.tsx'
import styles from './PageHeader.module.css'

interface PageHeaderProps {
  readonly title: string
  readonly facts: ReadonlyArray<string>
  readonly children?: ReactNode
}

export function PageHeader({ title, facts, children }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.heading}>
        <h1 className={styles.title}>{title}</h1>

        <Facts items={facts} />
      </div>

      {children === undefined ? null : <nav className={styles.actions}>{children}</nav>}
    </header>
  )
}
