import type { ReactNode } from 'react'
import { Link } from 'react-router'

import styles from './PillLink.module.css'

interface PillLinkProps {
  readonly to: string
  readonly children: ReactNode
}

export function PillLink({ to, children }: PillLinkProps) {
  return (
    <Link to={to} className={styles.pill}>
      {children}
    </Link>
  )
}
