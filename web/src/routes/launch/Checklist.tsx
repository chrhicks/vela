import styles from './Checklist.module.css'

interface ChecklistProps {
  readonly items: ReadonlyArray<string>
  readonly done: ReadonlySet<string>
  readonly onToggle: (item: string) => void
}

export function Checklist({ items, done, onToggle }: ChecklistProps) {
  return (
    <ul className={styles.checklist}>
      {items.map(item => (
        <li key={item}>
          <label className={styles.item}>
            <input type="checkbox" className={styles.box} checked={done.has(item)} onChange={() => onToggle(item)} />

            <span className={styles.text}>{item}</span>
          </label>
        </li>
      ))}
    </ul>
  )
}
