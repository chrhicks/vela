import { Button } from '@vela/ui'
import { pagingNote } from './presentation'
import type { AlertsState } from './use-alerts'
import './alerts.css'

/** Nothing to switch until Pushover keys are set up: the server has no phone to hold back. */
export function PhoneAlertsSwitch({ alerts }: { alerts: AlertsState }) {
  const { view, offline, switching, switchError, setPhoneAlerts } = alerts

  if (!view || view.phone.state === 'not-configured') return null

  const on = view.phoneAlertsOn

  return (
    <div className="phone-alerts-switch" data-phone-alerts={on ? 'on' : 'off'}>
      <p>
        Phone alerts: <strong>{on ? 'on' : 'off'}</strong>
        <span className="phone-alerts-switch__note"> · {on ? pagingNote(view.pagingWindow) : 'alerts show here only'}</span>
      </p>

      <Button disabled={offline} pending={switching} onClick={() => void setPhoneAlerts(!on)}>
        {on ? 'Turn off' : 'Turn on'}
      </Button>

      {switchError && <p role="alert">{switchError}</p>}
    </div>
  )
}
