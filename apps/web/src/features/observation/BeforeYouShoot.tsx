import type { CaptureCoolingView } from '@vela/model/web'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useRigObservation } from '../rig-detail/RigContext'

export function BeforeYouShoot({
  rigId,
  cooling,
  coolingStale,
  coolingAction,
  children,
}: {
  rigId: string
  cooling: CaptureCoolingView | null
  coolingStale: boolean
  coolingAction: ReactNode
  children: ReactNode
}) {
  const observation = useRigObservation()
  const focuser = observation?.view?.devices.find(device => device.kind === 'focuser')
  const focusStale = observation?.interrupted || focuser?.observation?.state === 'interrupted'
  const base = `/rigs/${encodeURIComponent(rigId)}`

  const focusStatus =
    focuser?.connection === 'connected' &&
    (focuser.status.availability === 'complete' || focuser.status.availability === 'partial')
      ? focuser.status
      : null

  const cooler = cooling
    ? [
        `Cooler ${cooling.state}`,
        cooling.sensorTemperatureC === undefined ? '' : `, sensor ${cooling.sensorTemperatureC.toFixed(1)}°C`,
        coolingStale ? ' (last known)' : '',
      ].join('')
    : 'Cooling unavailable'

  const focus = focusStatus
    ? [
        `Focuser ${focusStatus.position?.toLocaleString() ?? '—'}`,
        { idle: '', moving: ', moving', unknown: ', activity unknown' }[focusStatus.activity],
        focusStale ? ' (last known)' : '',
      ].join('')
    : `Focuser ${focuser?.connection ?? 'unavailable'}`

  return (
    <section className="tonight-before" aria-label="Before you shoot">
      <h2 className="vela-type-caption">Before you shoot</h2>
      <div className="tonight-before__row">
        <span>
          {cooler} · {focus}
        </span>
        {coolingAction}
        <Link className="tonight-link" to={`${base}/observe/alignment`}>
          Polar alignment
        </Link>
        <Link className="tonight-link" to={`${base}/observe/autofocus`}>
          Autofocus
        </Link>
      </div>
      {observation?.interrupted && observation.view && (
        <p role="status">
          Last known · {new Date(observation.view.refreshedAt).toLocaleTimeString()}
        </p>
      )}
      {children}
    </section>
  )
}
