import styles from './Facts.module.css'

interface FactsProps {
  readonly items: ReadonlyArray<string>
}

export function Facts({ items }: FactsProps) {
  return (
    <ul className={styles.facts}>
      {items.map(item => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}
