import { createFocusTrap } from 'focus-trap'
import { useEffect, useId, useRef } from 'react'
import type { HTMLAttributes, KeyboardEvent, MouseEvent, ReactNode } from 'react'

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

  useEffect(() => {
    const dialog = dialogRef.current
    if (!open || !dialog) return

    const returnFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : document.body
    const focusTrap = createFocusTrap(dialog, {
      allowOutsideClick: true,
      delayInitialFocus: false,
      escapeDeactivates: false,
      fallbackFocus: dialog,
      initialFocus: dialog,
      preventScroll: true,
      setReturnFocus: returnFocus,
    })
    focusTrap.activate()

    return () => {
      focusTrap.deactivate()
    }
  }, [open])

  if (!open) return null

  function dismissFromBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onDismiss?.()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    props.onKeyDown?.(event)
    if (event.defaultPrevented || event.key !== 'Escape') return

    event.preventDefault()
    onDismiss?.()
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
