import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { ThemeMode } from '../themes'

export type AppearancePreference = 'system' | 'light' | 'dark'

export interface AppearanceProps {
  open: boolean
  value: AppearancePreference
  systemMode: ThemeMode
  persistence: 'saved' | 'visit'
  onOpenChange: (open: boolean) => void
  onValueChange: (value: AppearancePreference) => void
}

const choices = ['system', 'light', 'dark'] as const

const labels = { system: 'System', light: 'Light', dark: 'Dark' }

/** Presentation only: the application owns preference resolution and persistence. */
export function Appearance({
  open,
  value,
  systemMode,
  persistence,
  onOpenChange,
  onValueChange,
}: AppearanceProps) {
  const id = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const radioRefs = useRef<Partial<Record<AppearancePreference, HTMLInputElement | null>>>({})
  const [placement, setPlacement] = useState<{ width: number; left?: number; top?: number; maxHeight?: number }>({ width: 360 })

  useLayoutEffect(() => {
    if (!open) return
    const root = rootRef.current
    const trigger = triggerRef.current

    if (!root || !trigger) return

    // Scope to a preview's theme surface as well as the browser viewport.
    const surface = root.closest('.vela-theme')

    function place() {
      if (!root || !trigger) return
      const anchor = trigger.getBoundingClientRect()
      const bounds = surface?.getBoundingClientRect()
      const leftEdge = Math.max(0, bounds?.left ?? 0) + 20
      const rightEdge = Math.min(window.innerWidth, bounds?.right ?? window.innerWidth) - 20
      const width = Math.min(360, rightEdge - leftEdge)
      const left = Math.max(leftEdge, Math.min(anchor.right - width, rightEdge - width))
      const below = window.innerHeight - anchor.bottom - 24
      const above = anchor.top - 24
      const naturalHeight = (panelRef.current?.scrollHeight ?? 360) + 2
      const placeAbove = below < Math.min(naturalHeight, 200) && above > below
      const maxHeight = Math.max(0, placeAbove ? above : below)
      const top = placeAbove ? anchor.top - Math.min(naturalHeight, maxHeight) - 4 : anchor.bottom + 4
      const rootBounds = root.getBoundingClientRect()
      setPlacement({ width, left: left - rootBounds.left, top: top - rootBounds.top, maxHeight })
    }

    place()
    const observer = new ResizeObserver(place)

    if (surface) observer.observe(surface)

    if (panelRef.current) observer.observe(panelRef.current)

    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    panelRef.current?.querySelector<HTMLInputElement>('input:checked')?.focus({ preventScroll: true })
  }, [open])

  useEffect(() => {
    if (!open) return

    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target))
        onOpenChange(false)
    }

    function dismissWithEscape(event: globalThis.KeyboardEvent) {
      if (event.defaultPrevented || event.key !== 'Escape') return
      event.preventDefault()
      onOpenChange(false)
      triggerRef.current?.focus({ preventScroll: true })
    }

    document.addEventListener('pointerdown', dismissOutside)
    document.addEventListener('keydown', dismissWithEscape)

    return () => {
      document.removeEventListener('pointerdown', dismissOutside)
      document.removeEventListener('keydown', dismissWithEscape)
    }
  }, [open, onOpenChange])

  function dismiss() {
    onOpenChange(false)
    triggerRef.current?.focus({ preventScroll: true })
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const direction = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1
    let index = (choices.indexOf(value) + direction + choices.length) % choices.length

    if (event.key === 'Home') index = 0

    if (event.key === 'End') index = choices.length - 1
    const next = choices[index]

    if (!next) return
    onValueChange(next)
    radioRefs.current[next]?.focus()
  }

  return (
    <div className="vela-appearance" ref={rootRef}>
      <button
        aria-controls={open ? `${id}-panel` : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Appearance"
        className="vela-icon-button vela-appearance__trigger"
        data-selected={open}
        data-tone="neutral"
        onClick={() => onOpenChange(!open)}
        ref={triggerRef}
        title="Appearance"
        type="button"
      >
        <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
          <path d="M3 5h14M3 10h14M3 15h14" />
          <circle cx="7" cy="5" r="2" />
          <circle cx="13" cy="10" r="2" />
          <circle cx="8" cy="15" r="2" />
        </svg>
      </button>
      {open ? (
        <section
          aria-labelledby={`${id}-title`}
          className="vela-appearance__panel"
          data-compact={placement.width < 360}
          id={`${id}-panel`}
          ref={panelRef}
          role="dialog"
          style={placement}
        >
          <header className="vela-appearance__header">
            <h2 id={`${id}-title`}>Appearance</h2>
            <button aria-label="Close appearance" className="vela-appearance__close" onClick={dismiss} type="button">
              <svg aria-hidden="true" fill="none" viewBox="0 0 20 20"><path d="m5 5 10 10M15 5 5 15" /></svg>
            </button>
          </header>
          <div className="vela-appearance__choices" role="radiogroup" aria-labelledby={`${id}-label`} onKeyDown={navigate}>
            <div className="vela-appearance__label" id={`${id}-label`}>Color theme</div>
            {choices.map(choice => (
              <label className="vela-appearance__option" data-selected={value === choice} key={choice}>
                <input
                  checked={value === choice}
                  name={`${id}-preference`}
                  onChange={() => onValueChange(choice)}
                  ref={element => { radioRefs.current[choice] = element }}
                  tabIndex={value === choice ? 0 : -1}
                  type="radio"
                  value={choice}
                />
                <span className="vela-appearance__option-copy">
                  <span>{labels[choice]}</span>
                  {choice === 'system' && value === 'system' ? <small>Currently {systemMode}</small> : null}
                </span>
                {value === choice && choice !== 'system' ? <small>Selected</small> : null}
              </label>
            ))}
          </div>
          <footer className="vela-appearance__footer">
            <p>{value === 'system' ? 'Follows your device’s appearance.' : `Always uses the ${value} theme.`}</p>
            <p role="status">{persistence === 'saved' ? 'Saved for this browser.' : 'For this visit only.'}</p>
          </footer>
        </section>
      ) : null}
    </div>
  )
}
