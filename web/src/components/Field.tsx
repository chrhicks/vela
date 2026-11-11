import styles from './Field.module.css'

interface FieldProps {
  readonly name: string
  readonly kind: 'search' | 'number' | 'text'
  readonly value: string
  readonly resting?: boolean
  readonly onChange: (value: string) => void
  readonly onFocus?: () => void
}

export function Field({ name, kind, value, resting = false, onChange, onFocus }: FieldProps) {
  return (
    <input
      className={`${styles.field} ${styles[kind]} ${resting ? styles.resting : ''}`}
      type={kind === 'search' ? 'search' : 'text'}
      inputMode={kind === 'number' ? 'numeric' : undefined}
      placeholder={kind === 'search' ? name : undefined}
      aria-label={name}
      value={value}
      onChange={event => onChange(event.target.value)}
      onFocus={onFocus}
    />
  )
}
