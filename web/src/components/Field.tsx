import styles from './Field.module.css'

interface FieldProps {
  readonly name: string
  readonly kind: 'search' | 'number'
  readonly value: string
  readonly onChange: (value: string) => void
}

export function Field({ name, kind, value, onChange }: FieldProps) {
  return (
    <input
      className={`${styles.field} ${styles[kind]}`}
      type={kind === 'search' ? 'search' : 'text'}
      inputMode={kind === 'number' ? 'numeric' : undefined}
      placeholder={kind === 'search' ? name : undefined}
      aria-label={name}
      value={value}
      onChange={event => onChange(event.target.value)}
    />
  )
}
