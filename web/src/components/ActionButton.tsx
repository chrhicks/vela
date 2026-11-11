import type { ReactNode } from 'react'

import styles from './ActionLink.module.css'

interface ActionButtonProps {
  readonly pressed?: boolean
  readonly quiet?: boolean
  readonly onPress?: () => void
  readonly children: ReactNode
}

export function ActionButton({ pressed, quiet = false, onPress, children }: ActionButtonProps) {
  const look = pressed === false ? styles.unpressed : quiet ? styles.quiet : ''

  return (
    <button type="button" className={`${styles.link} ${look}`} aria-pressed={pressed} onClick={onPress}>
      {children}
    </button>
  )
}
