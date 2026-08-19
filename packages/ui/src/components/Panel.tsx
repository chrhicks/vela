import type { HTMLAttributes, ReactNode } from 'react'

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  title?: string
  description?: string
  action?: ReactNode
  footer?: ReactNode
  elevation?: 'flat' | 'raised'
}

export function Panel({ title, description, action, footer, elevation = 'flat', children, className = '', ...props }: PanelProps) {
  return (
    <section className={`vela-panel ${className}`.trim()} data-elevation={elevation} {...props}>
      {title || description || action ? (
        <header className="vela-panel__header">
          <div>
            {title ? <h3 className="vela-panel__title">{title}</h3> : null}
            {description ? <p className="vela-panel__description">{description}</p> : null}
          </div>
          {action}
        </header>
      ) : null}
      <div className="vela-panel__body">{children}</div>
      {footer ? <footer className="vela-panel__footer">{footer}</footer> : null}
    </section>
  )
}
