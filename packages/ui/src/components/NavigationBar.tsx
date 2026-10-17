import { useId, useRef } from 'react'
import type { MouseEventHandler, ReactNode } from 'react'

export interface NavigationLink {
  href: string
  label: string
  current?: boolean
  onClick?: MouseEventHandler<HTMLAnchorElement>
  /** A line glyph for the phone tab bar. */
  icon?: ReactNode
}

export interface NavigationActivity {
  href: string
  onClick?: MouseEventHandler<HTMLAnchorElement>
  /** Accessible description including the activity's rig and freshness. */
  label: string
  rigName?: string
  completedCount: number
  status: string
  note?: string
  interrupted?: boolean
  /** Omit when exposure progress is unknown or the camera is reading an image. */
  progress?: { value: number; max: number }
}

export interface NavigationBarProps {
  home: { href: string; onClick?: MouseEventHandler<HTMLAnchorElement> }
  rigs: readonly { id: string; name: string }[]
  currentRigId: string
  onRigChange: (id: string) => void
  /** The selected rig's connection state in words, shown on the rig chip. */
  rigStatus?: string
  /** The selected rig's own page, offered first in the rig menu. When current, the chip carries the page emphasis. */
  rigPage?: NavigationLink
  links: readonly NavigationLink[]
  utility?: ReactNode
  /** Controls placed immediately after the rig selector. */
  actions?: ReactNode
  activity?: NavigationActivity
  /** A focused task may replace the full phone navigation with a return link and context. */
  compact?: { back: NavigationLink; label: string }
}

export function NavigationBar({
  home,
  rigs,
  currentRigId,
  onRigChange,
  rigStatus,
  rigPage,
  links,
  activity,
  utility,
  actions,
  compact,
}: NavigationBarProps) {
  const menuId = useId()
  const menu = useRef<HTMLDivElement>(null)
  const currentRig = rigs.find(rig => rig.id === currentRigId)
  const otherRigs = rigs.filter(rig => rig.id !== currentRigId)

  return (
    <div className="vela-navigation" data-compact={compact ? true : undefined}>
      <header className="vela-navigation__bar">
        <div className="vela-navigation__context">
          {compact && (
            <a
              className="vela-navigation__back"
              href={compact.back.href}
              onClick={compact.back.onClick}
            >
              {compact.back.label}
            </a>
          )}
          <a
            className="vela-navigation__brand"
            href={home.href}
            aria-label="Vela · all rigs"
            onClick={home.onClick}
          >
            vela
          </a>
        </div>
        {links.length > 0 && (
          <nav aria-label="Observing pages" className="vela-navigation__pages">
            {links.map(link => (
              <a
                key={link.href}
                href={link.href}
                aria-current={link.current ? 'page' : undefined}
                onClick={link.onClick}
              >
                {link.label}
              </a>
            ))}
          </nav>
        )}
        <div className="vela-navigation__context">
          {(utility || compact) && (
            <div className="vela-navigation__utility">
              {compact && <span className="vela-navigation__compact-label">{compact.label}</span>}
              {utility}
            </div>
          )}
          <div className="vela-navigation__rig-controls">
            <div className="vela-navigation__rig" data-current={rigPage?.current || undefined}>
              <button className="vela-navigation__rig-chip" popoverTarget={menuId} type="button">
                {rigStatus && <span className="vela-navigation__rig-dot" aria-hidden="true" />}
                <span className="vela-navigation__sr-only">Viewing rig </span>
                <span className="vela-navigation__rig-name">{currentRig?.name}</span>
                {rigStatus && <span className="vela-navigation__rig-status">{rigStatus}</span>}
                <svg aria-hidden="true" fill="none" viewBox="0 0 12 12">
                  <path d="M2 4l4 4 4-4" />
                </svg>
              </button>
              <div className="vela-navigation__rig-menu" id={menuId} popover="auto" ref={menu}>
                {rigPage && (
                  <a
                    href={rigPage.href}
                    aria-current={rigPage.current ? 'page' : undefined}
                    onClick={event => {
                      menu.current?.hidePopover()
                      rigPage.onClick?.(event)
                    }}
                  >
                    {rigPage.label}
                  </a>
                )}
                {otherRigs.length > 0 && (
                  <div className="vela-navigation__rig-choices">
                    {otherRigs.map(rig => (
                      <button
                        key={rig.id}
                        type="button"
                        onClick={() => {
                          menu.current?.hidePopover()
                          onRigChange(rig.id)
                        }}
                      >
                        {rig.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {actions && <div className="vela-navigation__actions">{actions}</div>}
          </div>
          {activity && (
            <a
              className="vela-navigation__activity"
              href={activity.href}
              onClick={activity.onClick}
              data-interrupted={activity.interrupted || undefined}
              aria-label={activity.label}
            >
              <span className="vela-navigation__capture-summary">
                <span>
                  {activity.rigName && <small>{activity.rigName} · </small>}
                  {activity.completedCount} captured
                </span>
                <small>{activity.status}</small>
              </span>
              {activity.progress && !activity.interrupted && (
                <progress
                  value={activity.progress.value}
                  max={activity.progress.max}
                  aria-hidden="true"
                />
              )}
              {activity.note && (
                <span className="vela-navigation__capture-note">{activity.note}</span>
              )}
            </a>
          )}
        </div>
      </header>
      {links.length > 0 && (
        <nav aria-label="Observing pages" className="vela-navigation__tabs">
          {links.map(link => (
            <a
              key={link.href}
              href={link.href}
              aria-current={link.current ? 'page' : undefined}
              onClick={link.onClick}
            >
              {link.icon}
              {link.label}
            </a>
          ))}
        </nav>
      )}
    </div>
  )
}
