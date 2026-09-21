import { useId } from 'react'
import type { SelectHTMLAttributes } from 'react'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: string
  message?: string
  invalid?: boolean
  options: readonly SelectOption[]
}

export function Select({
  label,
  message,
  invalid = false,
  options,
  className = '',
  id,
  ...props
}: SelectProps) {
  const generatedId = useId()
  const selectId = id ?? `vela-select-${generatedId.replace(/:/g, '')}`

  return (
    <label className="vela-field" htmlFor={selectId}>
      {label ? <span className="vela-field__label">{label}</span> : null}
      <span className="vela-select-shell">
        <select
          {...props}
          className={`vela-select ${className}`.trim()}
          data-invalid={invalid}
          id={selectId}
        >
          {options.map(option => (
            <option disabled={option.disabled} key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </span>
      {message ? (
        <span className="vela-field__message" data-invalid={invalid}>
          {message}
        </span>
      ) : null}
    </label>
  )
}
