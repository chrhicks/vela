import { Facts } from './Facts.tsx'
import styles from './Alert.module.css'

interface AlertProps {
  readonly title: string
  readonly facts: ReadonlyArray<string>
}

export function Alert({ title, facts }: AlertProps) {
  return (
    <section className={styles.alert} role="alert">
      <h2 className={styles.title}>{title}</h2>

      <Facts items={facts} tone="attention" />
    </section>
  )
}
