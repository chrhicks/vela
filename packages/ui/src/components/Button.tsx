import type { ButtonHTMLAttributes, ReactNode } from 'react'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: 'neutral' | 'accent' | 'quiet'
  size?: 'small' | 'medium' | 'large'
  leadingIcon?: ReactNode
}

export function Button({
  tone = 'neutral',
  size = 'medium',
  leadingIcon,
  children,
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button className={`vela-button ${className}`.trim()} data-size={size} data-tone={tone} {...props}>
      {leadingIcon}
      <span>{children}</span>
    </button>
  )
}
