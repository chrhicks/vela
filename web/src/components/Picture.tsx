import type { ReactNode } from 'react'

import styles from './Picture.module.css'

interface PictureProps {
  readonly label: string
  readonly detail: string
  readonly children: ReactNode
}

export function Picture({ label, detail, children }: PictureProps) {
  return (
    <figure className={styles.picture}>
      <figcaption className={styles.caption}>
        <span>{label}</span>
        <span>{detail}</span>
      </figcaption>

      <div className={styles.frame}>{children}</div>
    </figure>
  )
}
