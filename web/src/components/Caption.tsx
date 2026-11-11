import styles from './Caption.module.css'

interface CaptionProps {
  readonly children: string
}

export function Caption({ children }: CaptionProps) {
  return <h2 className={styles.caption}>{children}</h2>
}
