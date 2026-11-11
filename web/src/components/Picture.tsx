import type { ReactNode } from 'react'
import { Link } from 'react-router'

import styles from './Picture.module.css'

interface PictureProps {
  readonly label: string
  readonly detail: string
  readonly to?: string
  readonly children: ReactNode
}

export function Picture({ label, detail, to, children }: PictureProps) {
  return (
    <figure className={styles.picture}>
      <figcaption className={styles.caption}>
        <span>{label}</span>
        <span>{detail}</span>
      </figcaption>

      {to === undefined ? (
        <div className={styles.frame}>{children}</div>
      ) : (
        <Link to={to} className={styles.frame} aria-label={`Inspect: ${label}`}>
          {children}
        </Link>
      )}
    </figure>
  )
}
