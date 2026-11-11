import styles from './Facts.module.css'

interface FactsProps {
  readonly items: ReadonlyArray<string>
  readonly tone?: 'quiet' | 'attention'
}

export function Facts({ items, tone = 'quiet' }: FactsProps) {
  return (
    <ul className={`${styles.facts} ${styles[tone]}`}>
      {items.map(item => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}
