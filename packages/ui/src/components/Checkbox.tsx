import { useId } from 'react'
import type { InputHTMLAttributes, ReactNode } from 'react'

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode
  description?: ReactNode
}

export function Checkbox({
  label,
  description,
  className = '',
  id,
  ...props
}: CheckboxProps) {
  const generatedId = useId()
  const checkboxId = id ?? `vela-checkbox-${generatedId.replace(/:/g, '')}`

  return (
    <label className={`vela-checkbox ${className}`.trim()} htmlFor={checkboxId}>
      <input {...props} id={checkboxId} type="checkbox" />
      <span className="vela-checkbox__control">
        <i />
      </span>
      <span className="vela-checkbox__copy">
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
    </label>
  )
}
