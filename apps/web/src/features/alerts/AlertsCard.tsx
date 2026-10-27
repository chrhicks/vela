import { Button } from '@vela/ui'
import { clockTime, deliveryLabel, pagingLabel, phoneLabel, thresholdRows } from './presentation'
import { useRigAlerts } from './AlertsProvider'
import './alerts.css'

export function AlertsCard() {
  const alerts = useRigAlerts()

  if (!alerts) return null

  const { view, offline, test, sendTest } = alerts

  if (!view)
    return (
      <section className="alerts-card" aria-label="Alerts">
        <h2>Alerts</h2>
        <p className="alerts-card__muted">{offline ? 'Alerts could not be read.' : 'Loading alerts…'}</p>
      </section>
    )

  const phoneNotSetUp = view.phone.state === 'not-configured'

  return (
    <section className="alerts-card" aria-label="Alerts">
      <header>
        <h2>Alerts</h2>
        <p className="alerts-card__muted">
          {offline
            ? 'Interrupted · last known'
            : view.watching
              ? 'Watching the capture run'
              : 'Not watching · starts with a capture run'}
        </p>
      </header>

      <p data-paging={view.unattended ? 'on' : 'off'}>{pagingLabel(view.unattended)}</p>

      {view.phone.state !== 'ready' && (
        <p data-phone={view.phone.state} role={view.phone.state === 'failing' ? 'alert' : undefined}>
          {phoneLabel(view.phone)}
        </p>
      )}

      {view.alerts.length === 0 ? (
        <p className="alerts-card__muted">
          {view.watching ? 'No active alerts.' : 'No active alerts, and nothing is being checked.'}
        </p>
      ) : (
        <ul className="alerts-card__list">
          {view.alerts.map(alert => (
            <li key={alert.id} data-level={alert.level}>
              <strong>{alert.level === 'critical' ? 'Critical' : 'Warning'}</strong> {alert.message}
              <span className="alerts-card__muted">
                {' '}· raised {clockTime(alert.raisedAt)}
                {alert.acknowledged && ' · acknowledged'}
                {' · '}{deliveryLabel(alert)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {view.unavailable.length > 0 && (
        <ul className="alerts-card__list alerts-card__unavailable">
          {view.unavailable.map(line => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      <div className="alerts-card__test">
        <Button
          disabled={phoneNotSetUp || offline}
          pending={test.state === 'sending'}
          onClick={() => void sendTest()}
        >
          Send test
        </Button>

        <p className="alerts-card__muted" role="status">
          {test.state === 'sent' && 'Test sent · Pushover accepted it'}
          {test.state === 'failed' && test.message}
          {test.state === 'idle' && phoneNotSetUp && 'Set up phone alerts to send a test.'}
        </p>
      </div>

      <details>
        <summary>Thresholds in use</summary>
        <dl>
          {thresholdRows(view.thresholds).map(row => (
            <div key={row.key}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  )
}
