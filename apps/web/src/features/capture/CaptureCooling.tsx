import { Button, Checkbox, Input } from '@vela/ui'
import type { CaptureCoolingView } from '@vela/model/web'
import { useState } from 'react'

function formatTemperature(value: number) {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 })} °C`
}

function formatPower(value: number) {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}%`
}

export function coolingSummary(cooling: CaptureCoolingView | null | undefined) {
  if (!cooling) return null

  const sensor = cooling.sensorTemperatureC === undefined ? null : formatTemperature(cooling.sensorTemperatureC)

  if (cooling.state === 'off') {
    return sensor ? `Cooler off · sensor ${sensor}` : 'Cooler off'
  }

  const power = cooling.powerPercent === undefined ? null : ` · ${formatPower(cooling.powerPercent)} power`

  return sensor ? `Cooler on · sensor ${sensor}${power ?? ''}` : `Cooler on${power ?? ''}`
}

export function CaptureCooling({
  cooling,
  disabled,
  pending,
  error,
  unconfirmed,
  runActive,
  onCooler,
  onSetpoint,
  onCheck,
}: {
  cooling: CaptureCoolingView
  disabled: boolean
  pending: boolean
  error: string | null
  unconfirmed: boolean
  runActive?: boolean
  onCooler: (coolerOn: boolean) => void
  onSetpoint: (setpointC: number) => void
  onCheck?: () => void
}) {
  const [target, setTarget] = useState<string | null>(null)
  const requested = target ?? (cooling.setpointC === undefined ? '' : String(cooling.setpointC))
  const setpoint = Number(requested)
  const validTarget = requested.trim() !== '' && Number.isFinite(setpoint) && setpoint >= -80 && setpoint <= 50

  return <section className="capture-page__cooling" aria-label="Camera cooling">
    <h3>Cooling</h3>
    <dl>
      <div>
        <dt>Cooler</dt>
        <dd data-state={cooling.state}>{cooling.state === 'on' ? 'On' : 'Off'}</dd>
      </div>
      {cooling.sensorTemperatureC !== undefined && <div>
        <dt>Sensor</dt>
        <dd>{formatTemperature(cooling.sensorTemperatureC)}</dd>
      </div>}
      {cooling.setpointC !== undefined && <div>
        <dt>Requested</dt>
        <dd>{formatTemperature(cooling.setpointC)}</dd>
      </div>}
      {cooling.powerPercent !== undefined && <div>
        <dt>Power</dt>
        <dd>{formatPower(cooling.powerPercent)}</dd>
      </div>}
    </dl>
    <p>
      {unconfirmed ? 'Cooler command outcome unknown. Check the camera before assuming it changed.'
        : pending ? 'Confirming cooler state…'
          : cooling.state === 'off'
            ? 'Cooler is off. A sensor near the requested temperature is not confirmation that cooling is running.'
            : cooling.powerPercent !== undefined
              ? 'Cooler is on. Power shows cooling effort, not a finished temperature.'
              : 'Cooler is on. Sensor temperature is live; it is not a substitute for the cooler switch.'}
    </p>
    <Checkbox
      label="Cooler on"
      description="Vela does not turn this on by itself."
      checked={cooling.state === 'on'}
      disabled={disabled}
      onChange={event => onCooler(event.target.checked)}
    />
    {cooling.canSetTemperature && <form onSubmit={event => {
      event.preventDefault()

      if (validTarget) onSetpoint(setpoint)
    }}>
      <Input
        label="Target temperature · °C"
        type="number"
        min="-80"
        max="50"
        step="0.1"
        value={requested}
        disabled={disabled}
        invalid={!validTarget}
        message={validTarget ? 'Sets the requested temperature only. Turn the cooler on separately.' : 'Choose −80 to 50 °C.'}
        onChange={event => setTarget(event.target.value)}
      />
      <Button type="submit" disabled={disabled || !validTarget}>{pending ? 'Confirming…' : 'Set temperature'}</Button>
    </form>}
    {error && <p role="status">{error}</p>}
    {unconfirmed && onCheck && <Button type="button" disabled={pending || runActive} onClick={onCheck}>Check camera cooling</Button>}
  </section>
}
