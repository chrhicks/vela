import { useEffect, useId, useRef } from 'react'
import type { HTMLAttributes, KeyboardEvent, MouseEvent, ReactNode } from 'react'

const focusableSelector = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export interface DialogProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  open: boolean
  title: string
  description?: string
  footer?: ReactNode
  dismissLabel?: string
  onDismiss?: () => void
}

export function Dialog({
  open,
  title,
  description,
  footer,
  dismissLabel = 'Close dialog',
  onDismiss,
  children,
  className = '',
  ...props
}: DialogProps) {
  const titleId = `vela-dialog-title-${useId().replace(/:/g, '')}`
  const descriptionId = `vela-dialog-description-${useId().replace(/:/g, '')}`
  const dialogRef = useRef<HTMLElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const animationFrame = window.requestAnimationFrame(() => dialogRef.current?.focus())

    return () => {
      window.cancelAnimationFrame(animationFrame)
      if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus()
    }
  }, [open])

  if (!open) return null

  function dismissFromBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onDismiss?.()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    props.onKeyDown?.(event)
    if (event.defaultPrevented) return

    if (event.key === 'Escape') {
      event.preventDefault()
      onDismiss?.()
      return
    }

    if (event.key !== 'Tab' || !dialogRef.current) return

    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector)]
    if (focusable.length === 0) {
      event.preventDefault()
      dialogRef.current.focus()
      return
    }

    const first = focusable[0]
    const last = focusable.at(-1)
    const active = document.activeElement

    if (event.shiftKey && (active === first || active === dialogRef.current || !dialogRef.current.contains(active))) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  return (
    <div className="vela-dialog-layer" onMouseDown={dismissFromBackdrop}>
      <section
        {...props}
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className={`vela-dialog ${className}`.trim()}
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="vela-dialog__header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          {onDismiss ? (
            <button aria-label={dismissLabel} className="vela-dialog__close" onClick={onDismiss} type="button">
              <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
                <path d="m5 5 10 10M15 5 5 15" />
              </svg>
            </button>
          ) : null}
        </header>
        <div className="vela-dialog__body">{children}</div>
        {footer ? <footer className="vela-dialog__footer">{footer}</footer> : null}
      </section>
    </div>
  )
}
