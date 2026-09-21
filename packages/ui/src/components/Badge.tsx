import type { HTMLAttributes, ReactNode } from 'react'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'neutral' | 'accent' | 'positive' | 'warning' | 'danger'
  size?: 'small' | 'medium'
  marker?: ReactNode
}

export function Badge({
  tone = 'neutral',
  size = 'medium',
  marker,
  children,
  className = '',
  ...props
}: BadgeProps) {
  return (
    <span className={`vela-badge ${className}`.trim()} data-size={size} data-tone={tone} {...props}>
      {marker ? <span className="vela-badge__marker">{marker}</span> : null}
      {children}
    </span>
  )
}
