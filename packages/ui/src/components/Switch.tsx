import type { ButtonHTMLAttributes } from 'react'

export interface SwitchProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onChange' | 'children' | 'role' | 'aria-checked'
> {
  label: string
  checked: boolean
  pending?: boolean
  onChange: (checked: boolean) => void
}

/** A controlled observed setting; pending never pretends the requested value is confirmed. */
export function Switch({
  label,
  checked,
  pending = false,
  onChange,
  className = '',
  ...props
}: SwitchProps) {
  return (
    <button
      {...props}
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      aria-busy={pending || undefined}
      aria-disabled={pending || props.disabled || undefined}
      className={`vela-switch ${className}`.trim()}
      onClick={event => {
        if (pending || props.disabled) return
        props.onClick?.(event)

        if (!event.defaultPrevented) onChange(!checked)
      }}
    >
      <span className="vela-switch__track" aria-hidden="true">
        <span />
      </span>
    </button>
  )
}
