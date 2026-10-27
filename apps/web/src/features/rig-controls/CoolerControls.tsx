import { Button, Checkbox, Input } from '@vela/ui'
import type { CaptureCoolingView } from '@vela/model/web'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { CoolingBlocker } from './cooling-blocker'

function formatTemperature(value: number) {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 })} °C`
}

function formatPower(value: number) {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}%`
}

export function CoolerControls({
  cooling,
  disabled,
  pending,
  checking,
  error,
  unconfirmed,
  runActive,
  stale = false,
  blocker = null,
  onCooler,
  onSetpoint,
  onCheck,
}: {
  cooling: CaptureCoolingView | null
  disabled: boolean
  /** The readings are last known: the connection is interrupted or an outcome is unknown. */
  stale?: boolean
  blocker?: CoolingBlocker
  pending: boolean
  checking?: boolean
  error: string | null
  unconfirmed: boolean
  runActive?: boolean
  onCooler: (coolerOn: boolean) => void
  onSetpoint: (setpointC: number) => void
  onCheck?: () => void
}) {
  const [target, setTarget] = useState<string | null>(null)
  const requested = target ?? (cooling?.setpointC === undefined ? '' : String(cooling.setpointC))
  const setpoint = Number(requested)

  const validTarget =
    requested.trim() !== '' && Number.isFinite(setpoint) && setpoint >= -80 && setpoint <= 50

  // While a command confirms, the previous refusal keeps its space (invisibly) so
  // a repeated answer does not move the switch or the page.
  const [lastRefusal, setLastRefusal] = useState<string | null>(null)

  useEffect(() => {
    if (!pending) setLastRefusal(error)
  }, [pending, error])

  const feedback = (
    <CoolingFeedback
      blocker={blocker}
      error={error}
      held={pending ? lastRefusal : null}
      unconfirmed={unconfirmed}
      checking={pending || checking || runActive}
      onCheck={onCheck}
    />
  )

  let description

  // The description explains observed state without claiming it is current, and
  // never changes with a command; command feedback has its own slot below the
  // switch, so a tap never resizes what sits above the control.
  if (!cooling) description = 'Check the camera before changing cooling.'
  else if (cooling.state === 'off') {
    description =
      'Cooler is off. A sensor near the requested temperature is not confirmation that cooling is running.'
  } else if (cooling.powerPercent !== undefined) {
    description = 'Cooler is on. Power shows cooling effort, not a finished temperature.'
  } else {
    description =
      'Cooler is on. Sensor temperature is not a substitute for the cooler switch.'
  }

  return (
    <section className="rig-controls__section rig-controls__cooler" aria-label="Camera cooling">
      <h3>{stale ? 'Cooler · last known' : 'Cooler'}</h3>
      {cooling ? (
        <dl>
          <div>
            <dt>Cooler</dt>
            <dd data-state={cooling.state}>{cooling.state === 'on' ? 'On' : 'Off'}</dd>
          </div>
          {cooling.sensorTemperatureC !== undefined && (
            <div>
              <dt>Sensor</dt>
              <dd>{formatTemperature(cooling.sensorTemperatureC)}</dd>
            </div>
          )}
          {cooling.setpointC !== undefined && (
            <div>
              <dt>Requested</dt>
              <dd>{formatTemperature(cooling.setpointC)}</dd>
            </div>
          )}
          {cooling.powerPercent !== undefined && (
            <div>
              <dt>Power</dt>
              <dd>{formatPower(cooling.powerPercent)}</dd>
            </div>
          )}
        </dl>
      ) : (
        <p>Cooling state is unavailable. Waiting for a fresh camera reading.</p>
      )}
      <p>{description}</p>
      {cooling && (
        <>
          <Checkbox
            label="Cooler on"
            description={
              // Both notes occupy one cell so confirming never changes the switch's height.
              <span className="rig-controls__cooler-note">
                <span aria-hidden={pending || undefined}>Vela does not turn this on by itself.</span>
                <span aria-hidden={!pending || undefined}>Confirming cooler state…</span>
              </span>
            }
            checked={cooling.state === 'on'}
            disabled={disabled}
            onChange={event => onCooler(event.target.checked)}
          />
          {feedback}
          {cooling.canSetTemperature && (
            <form
              onSubmit={event => {
                event.preventDefault()

                if (validTarget) onSetpoint(setpoint)
              }}
            >
              <Input
                label="Target temperature · °C"
                type="number"
                min="-80"
                max="50"
                step="0.1"
                value={requested}
                disabled={disabled}
                invalid={!validTarget}
                message={
                  validTarget
                    ? 'Sets the requested temperature only. Turn the cooler on separately.'
                    : 'Choose −80 to 50 °C.'
                }
                onChange={event => setTarget(event.target.value)}
              />
              <Button type="submit" disabled={disabled || !validTarget}>
                {pending ? 'Confirming…' : 'Set temperature'}
              </Button>
            </form>
          )}
        </>
      )}
      {!cooling && feedback}
    </section>
  )
}

function CoolingFeedback({
  blocker,
  error,
  held,
  unconfirmed,
  checking,
  onCheck,
}: {
  blocker: CoolingBlocker
  error: string | null
  held: string | null
  unconfirmed: boolean
  checking: boolean | undefined
  onCheck: (() => void) | undefined
}) {
  // An unknown outcome comes first: Chris must check before anything else. A
  // current blocker then explains the state better than an earlier refusal.
  if (unconfirmed || (error && !blocker)) {
    return (
      <div className="rig-controls__notice" role="status">
        <strong>{unconfirmed ? 'Command outcome unknown' : 'Cooling command failed'}</strong>
        <p>
          {unconfirmed
            ? 'Cooler command outcome unknown. Check the camera before assuming it changed.'
            : error}
        </p>
        {unconfirmed && onCheck && (
          <Button type="button" disabled={checking} onClick={onCheck}>
            Check camera cooling
          </Button>
        )}
      </div>
    )
  }

  if (held && !blocker) {
    return (
      <div
        className="rig-controls__notice"
        data-held=""
        aria-hidden="true"
      >
        <strong>Cooling command failed</strong>
        <p>{held}</p>
      </div>
    )
  }

  if (!blocker) return null

  return (
    <div className="rig-controls__notice" role="status">
      <strong>Cooling unavailable</strong>
      <p>{blocker.message}</p>
      {blocker.action && (
        <Link className="tonight-link" to={blocker.action.to}>
          {blocker.action.label}
        </Link>
      )}
    </div>
  )
}
