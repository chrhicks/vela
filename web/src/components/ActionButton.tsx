import type { ReactNode } from 'react'

import styles from './ActionLink.module.css'

interface ActionButtonProps {
  readonly pressed?: boolean
  readonly onPress?: () => void
  readonly children: ReactNode
}

export function ActionButton({ pressed, onPress, children }: ActionButtonProps) {
  return (
    <button
      type="button"
      className={pressed === false ? `${styles.link} ${styles.unpressed}` : styles.link}
      aria-pressed={pressed}
      onClick={onPress}
    >
      {children}
    </button>
  )
}
