import type { AlertView } from '@vela/model/web'
import { Button } from '@vela/ui'
import { ageLabel, bannerPhoneNote, clockTime } from './presentation'
import { useRigAlerts } from './AlertsProvider'
import { PhoneAlertsSwitch } from './PhoneAlertsSwitch'
import './alerts.css'

const levelLabel = { critical: 'Critical', warn: 'Warning' }

export function AlertBanner() {
  const alerts = useRigAlerts()

  if (!alerts?.view) return null

  const { view, offline, acknowledging, acknowledgeError, acknowledge } = alerts
  const interrupted = offline && (view.watching || view.alerts.length > 0)

  const phoneOff = view.phone.state !== 'not-configured' && !view.phoneAlertsOn

  if (view.alerts.length === 0 && !interrupted && !phoneOff) return null

  const now = Date.now()

  return (
    <section className="alert-banner" aria-label="Rig alerts">
      {phoneOff && <PhoneAlertsSwitch alerts={alerts} />}

      {interrupted && (
        <p className="alert-banner__interrupted" role="status">
          Alert checks interrupted · showing the last view Vela received
        </p>
      )}

      <ul>
        {view.alerts.map(alert => (
          <AlertRow
            key={alert.id}
            alert={alert}
            now={now}
            stale={offline}
            pending={acknowledging === alert.id}
            onAcknowledge={() => void acknowledge(alert.id)}
          />
        ))}
      </ul>

      {acknowledgeError && <p role="alert">{acknowledgeError}</p>}
    </section>
  )
}

function AlertRow({
  alert,
  now,
  stale,
  pending,
  onAcknowledge,
}: {
  alert: AlertView
  now: number
  stale: boolean
  pending: boolean
  onAcknowledge: () => void
}) {
  const phoneNote = bannerPhoneNote(alert)

  return (
    <li className="alert-banner__alert" data-level={alert.level} role={alert.level === 'critical' ? 'alert' : 'status'}>
      <span className="alert-banner__level">{levelLabel[alert.level]}</span>

      <div className="alert-banner__text">
        <p>{alert.message}</p>
        <p className="alert-banner__detail">
          Raised {clockTime(alert.raisedAt)} · {ageLabel(alert.raisedAt, now)}
          {alert.acknowledged && ' · Acknowledged'}
          {phoneNote && ` · ${phoneNote}`}
        </p>
      </div>

      {!alert.acknowledged && (
        <Button
          aria-label={`Acknowledge ${alert.message}`}
          disabled={stale}
          pending={pending}
          onClick={onAcknowledge}
        >
          Acknowledge
        </Button>
      )}
    </li>
  )
}
