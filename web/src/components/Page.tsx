import type { ReactNode } from 'react'

import styles from './Page.module.css'

interface PageProps {
  readonly width: 'phone' | 'wide'
  readonly children: ReactNode
}

export function Page({ width, children }: PageProps) {
  return <main className={`${styles.page} ${styles[width]}`}>{children}</main>
}
