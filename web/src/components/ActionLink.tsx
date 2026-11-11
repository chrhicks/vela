import type { ReactNode } from 'react'
import { Link } from 'react-router'

import styles from './ActionLink.module.css'

interface ActionLinkProps {
  readonly to: string
  readonly children: ReactNode
}

export function ActionLink({ to, children }: ActionLinkProps) {
  return (
    <Link to={to} className={styles.link}>
      {children}
    </Link>
  )
}
