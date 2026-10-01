import type { ButtonHTMLAttributes, ReactNode } from 'react'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  tone?: 'neutral' | 'accent' | 'quiet'
  pending?: boolean
  icon: ReactNode
}

export function IconButton({
  label,
  tone = 'neutral',
  pending = false,
  disabled,
  onClick,
  icon,
  className = '',
  ...props
}: IconButtonProps) {
  return (
    <button
      aria-label={label}
      className={`vela-icon-button ${className}`.trim()}
      data-tone={tone}
      title={label}
      {...props}
      disabled={disabled}
      aria-busy={pending || props['aria-busy']}
      aria-disabled={pending || disabled || props['aria-disabled']}
      onClick={event => {
        if (pending) {
          event.preventDefault()

          return
        }

        onClick?.(event)
      }}
    >
      {icon}
    </button>
  )
}
