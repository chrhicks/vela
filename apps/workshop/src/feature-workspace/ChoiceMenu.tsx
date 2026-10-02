import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@vela/ui'
import { CheckIcon, ChevronIcon } from './Icons'

interface Choice {
  id: string
  label: string
  description?: string
}

interface ChoiceMenuProps {
  label: string
  title: string
  value: string
  choices: Choice[]
  footer?: string
  onSelect: (id: string) => void
}

export function ChoiceMenu({ label, title, value, choices, footer, onSelect }: ChoiceMenuProps) {
  const id = useId()
  const trigger = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 16, top: 64, width: 320, maxHeight: 600 })
  const selected = choices.find(choice => choice.id === value)

  useLayoutEffect(() => {
    if (!open) return

    function place() {
      const anchor = trigger.current?.getBoundingClientRect()

      if (!anchor) return

      const width = Math.min(340, window.innerWidth - 32)
      const left = Math.max(16, Math.min(anchor.right - width, window.innerWidth - width - 16))
      const naturalHeight = panel.current?.scrollHeight ?? 320
      const below = window.innerHeight - anchor.bottom - 22
      const above = anchor.top - 22
      const placeAbove = below < Math.min(naturalHeight, 180) && above > below
      const maxHeight = Math.max(80, placeAbove ? above : below)
      const top = placeAbove ? anchor.top - Math.min(naturalHeight, maxHeight) - 6 : anchor.bottom + 6
      setPosition({ left, top, width, maxHeight })
    }

    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)

    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return

    panel.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()

    function outside(event: PointerEvent) {
      if (!(event.target instanceof Node)) return

      if (!panel.current?.contains(event.target) && !trigger.current?.contains(event.target))
        setOpen(false)
    }

    function focusOutside(event: FocusEvent) {
      if (!(event.target instanceof Node)) return

      if (!panel.current?.contains(event.target) && !trigger.current?.contains(event.target))
        setOpen(false)
    }

    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', focusOutside)

    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', focusOutside)
    }
  }, [open])

  function close() {
    setOpen(false)
    trigger.current?.querySelector('button')?.focus()
  }

  function handleKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()

      return
    }

    const buttons = [...(panel.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])]
    const current = buttons.findIndex(button => button === document.activeElement)
    let next = current

    if (event.key === 'ArrowDown') next = (current + 1) % buttons.length
    else if (event.key === 'ArrowUp') next = (current - 1 + buttons.length) % buttons.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = buttons.length - 1
    else if (event.key === 'Tab') {
      // Return to the trigger before the browser advances through the toolbar.
      setOpen(false)
      trigger.current?.querySelector('button')?.focus()

      return
    } else return

    event.preventDefault()
    buttons[next]?.focus()
  }

  return (
    <>
      <span className="feature-menu-anchor" ref={trigger}>
        <Button
          className="feature-choice-trigger"
          tone="quiet"
          aria-label={`${label}: ${selected?.label ?? value}`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={() => setOpen(current => !current)}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              setOpen(true)
            }
          }}
        >
          <span>{label === 'Appearance' ? '' : `${label}: `}{selected?.label ?? value}</span>
          <ChevronIcon />
        </Button>
      </span>
      {open && createPortal(
        <div
          className="feature-choice-menu"
          role="menu"
          aria-label={title}
          id={id}
          ref={panel}
          style={position}
          onKeyDown={handleKeys}
        >
          <h2>{title}</h2>
          {choices.map(choice => (
            <button
              key={choice.id}
              type="button"
              role="menuitemradio"
              aria-checked={choice.id === value}
              tabIndex={choice.id === value ? 0 : -1}
              onClick={() => {
                onSelect(choice.id)
                close()
              }}
            >
              <span><strong>{choice.label}</strong>{choice.description && <small>{choice.description}</small>}</span>
              {choice.id === value && <CheckIcon />}
            </button>
          ))}
          {footer && <p>{footer}</p>}
        </div>,
        document.body,
      )}
    </>
  )
}
