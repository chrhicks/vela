import type { ButtonHTMLAttributes, ReactNode } from 'react'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  tone?: 'neutral' | 'accent' | 'quiet'
  size?: 'small' | 'medium' | 'large'
  icon: ReactNode
}

export function IconButton({ label, tone = 'neutral', size = 'medium', icon, className = '', ...props }: IconButtonProps) {
  return (
    <button aria-label={label} className={`vela-icon-button ${className}`.trim()} data-size={size} data-tone={tone} title={label} {...props}>
      {icon}
    </button>
  )
}
