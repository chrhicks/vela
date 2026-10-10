import { Button, Checkbox, Input } from '@vela/ui'
import type { CaptureCoolingBlocker, CaptureCoolingView } from '@vela/model/web'
import { useState } from 'react'
import { Link } from 'react-router'

function formatTemperature(value: number) {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 })} °C`
}

function formatPower(value: number) {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}%`
}

export function coolingSummary(cooling: CaptureCoolingView | null | undefined) {
  if (!cooling) return null

  const sensor =
    cooling.sensorTemperatureC === undefined ? null : formatTemperature(cooling.sensorTemperatureC)

  if (cooling.state === 'off') {
    return sensor ? `Cooler off · sensor ${sensor}` : 'Cooler off'
  }

  const power =
    cooling.powerPercent === undefined ? null : ` · ${formatPower(cooling.powerPercent)} power`

  return sensor ? `Cooler on · sensor ${sensor}${power ?? ''}` : `Cooler on${power ?? ''}`
}

/** What currently holds the rig, and where Chris can resolve it. */
export function coolingBlocker(blockedBy: CaptureCoolingBlocker | undefined, rigPath: string) {
  switch (blockedBy) {
    case undefined:
      return null
    case 'alignment':
      return {
        message: 'Polar alignment is using the rig. Stop or finish alignment to change cooling.',
        action: { label: 'Open polar alignment', to: `${rigPath}/observe/alignment` },
      }
    case 'autofocus':
      return {
        message: 'Autofocus is using the rig. Cooling can change when it finishes.',
        action: { label: 'Open autofocus', to: `${rigPath}/observe/autofocus` },
      }
    case 'framing':
      return { message: 'Framing is using the rig. Cooling can change when it finishes.' }
    case 'capture':
      return { message: 'Cooling is locked while capture runs so Stop stays available.' }
    case 'rig':
      return { message: 'Another rig command is finishing. Cooling will be available when it does.' }
  }
}

export type CoolingBlocker = ReturnType<typeof coolingBlocker>

export function CaptureCooling({
  cooling,
  disabled,
  pending,
  checking,
  error,
  unconfirmed,
  runActive,
  blocker = null,
  onCooler,
  onSetpoint,
  onCheck,
}: {
  cooling: CaptureCoolingView | null
  disabled: boolean
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

  const feedback = (
    <CoolingFeedback
      blocker={blocker}
      error={error}
      unconfirmed={unconfirmed}
      checking={pending || checking || runActive}
      onCheck={onCheck}
    />
  )

  let description

  // The description follows observed state only; command feedback has its own
  // slot below the switch, so a tap never resizes what sits above the control.
  if (!cooling) description = 'Check the camera before changing cooling.'
  else if (cooling.state === 'off') {
    description =
      'Cooler is off. A sensor near the requested temperature is not confirmation that cooling is running.'
  } else if (cooling.powerPercent !== undefined) {
    description = 'Cooler is on. Power shows cooling effort, not a finished temperature.'
  } else {
    description =
      'Cooler is on. Sensor temperature is live; it is not a substitute for the cooler switch.'
  }

  return (
    <section className="capture-page__cooling" aria-label="Camera cooling">
      <h3>Cooling</h3>
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
            description={pending ? 'Confirming cooler state…' : 'Vela does not turn this on by itself.'}
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
  unconfirmed,
  checking,
  onCheck,
}: {
  blocker: CoolingBlocker
  error: string | null
  unconfirmed: boolean
  checking: boolean | undefined
  onCheck: (() => void) | undefined
}) {
  // An unknown outcome comes first: Chris must check before anything else. A
  // current blocker then explains the state better than an earlier refusal.
  if (unconfirmed || (error && !blocker)) {
    return (
      <div className="capture-page__warning capture-page__cooling-feedback" role="status">
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

  if (!blocker) return null

  return (
    <div className="capture-page__warning capture-page__cooling-feedback" role="status">
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
