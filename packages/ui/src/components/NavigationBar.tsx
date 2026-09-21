import type { MouseEventHandler } from 'react'

export interface NavigationLink {
  href: string
  label: string
  current?: boolean
  onClick?: MouseEventHandler<HTMLAnchorElement>
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
  links: readonly NavigationLink[]
  activity?: NavigationActivity
}

export function NavigationBar({
  home,
  rigs,
  currentRigId,
  onRigChange,
  links,
  activity,
}: NavigationBarProps) {
  return (
    <div className="vela-navigation">
      <header className="vela-navigation__bar">
        <div className="vela-navigation__context">
          <a
            className="vela-navigation__brand"
            href={home.href}
            aria-label="Vela · all rigs"
            onClick={home.onClick}
          >
            V<span>ela</span>
          </a>
          <span className="vela-navigation__divider" aria-hidden="true" />
          <label className="vela-navigation__rig">
            <span className="vela-navigation__sr-only">Viewing rig</span>
            <select value={currentRigId} onChange={event => onRigChange(event.target.value)}>
              {rigs.map(rig => (
                <option value={rig.id} key={rig.id}>
                  {rig.name}
                </option>
              ))}
            </select>
          </label>
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
      </header>
    </div>
  )
}
