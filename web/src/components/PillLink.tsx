import type { ReactNode } from 'react'
import { Link } from 'react-router'

import styles from './PillLink.module.css'

interface PillLinkProps {
  readonly to: string
  readonly waiting?: boolean
  readonly children: ReactNode
}

export function PillLink({ to, waiting = false, children }: PillLinkProps) {
  if (waiting) {
    return (
      <span className={`${styles.pill} ${styles.waiting}`} aria-disabled="true">
        {children}
      </span>
    )
  }

  return (
    <Link to={to} className={styles.pill}>
      {children}
    </Link>
  )
}
