import type { CaptureCoolingView } from '@vela/model/web'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useRigObservation } from '../rig-detail/RigContext'

export function EquipmentSummary({
  rigName,
  rigId,
  coolingAction,
  cooling,
  coolingStale,
}: {
  rigName: string
  rigId: string
  coolingAction: ReactNode
  cooling: CaptureCoolingView | null
  coolingStale: boolean
}) {
  const observation = useRigObservation()
  const focuser = observation?.view?.devices.find(device => device.kind === 'focuser')
  const focusStale = observation?.interrupted || focuser?.observation?.state === 'interrupted'

  const focusStatus =
    focuser?.connection === 'connected' &&
    (focuser.status.availability === 'complete' || focuser.status.availability === 'partial')
      ? focuser.status
      : null

  return (
    <footer className="tonight-equipment">
      <div>
        <strong>{rigName}</strong>
        <span>
          Camera{'  '}
          {cooling
            ? `${cooling.sensorTemperatureC?.toFixed(1) ?? '—'}°C · ${coolingStale ? 'last known' : `Cooler ${cooling.state}`}`
            : 'Temperature / cooling unavailable'}
        </span>
        <span>
          Focuser{'  '}
          {focusStatus
            ? `${focusStatus.position?.toLocaleString() ?? '—'} · ${focusStale ? 'last known' : { idle: 'Idle', moving: 'Moving', unknown: 'Activity unknown' }[focusStatus.activity]}`
            : (focuser?.connection ?? 'Unavailable')}
        </span>
      </div>
      <div>
        {coolingAction}
        {observation?.interrupted && (
          <span role="status">
            Last known ·{' '}
            {observation.view && new Date(observation.view.refreshedAt).toLocaleTimeString()}
          </span>
        )}
        <Link className="tonight-link" to={`/rigs/${encodeURIComponent(rigId)}`}>
          Equipment & settings
        </Link>
      </div>
    </footer>
  )
}
