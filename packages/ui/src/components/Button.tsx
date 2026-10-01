import type { ButtonHTMLAttributes, ReactNode } from 'react'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: 'neutral' | 'accent' | 'quiet'
  pending?: boolean
  leadingIcon?: ReactNode
}

export function Button({
  tone = 'neutral',
  pending = false,
  disabled,
  onClick,
  leadingIcon,
  children,
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      className={`vela-button ${className}`.trim()}
      data-tone={tone}
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
      {leadingIcon}
      <span>{children}</span>
    </button>
  )
}
