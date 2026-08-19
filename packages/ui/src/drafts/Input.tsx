import type { InputHTMLAttributes } from 'react'

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string
  message?: string
  invalid?: boolean
}

export function Input({ label, message, invalid = false, className = '', id, ...props }: InputProps) {
  const inputId = id ?? `vela-input-${label?.toLowerCase().replace(/[^a-z0-9]+/g, '-') ?? 'field'}`
  return (
    <label className="vela-field" htmlFor={inputId}>
      {label ? <span className="vela-field__label">{label}</span> : null}
      <input {...props} className={`vela-input ${className}`.trim()} data-invalid={invalid} id={inputId} />
      {message ? <span className="vela-field__message" data-invalid={invalid}>{message}</span> : null}
    </label>
  )
}
