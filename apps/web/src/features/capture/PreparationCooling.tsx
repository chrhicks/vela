import { useId, useState } from 'react'
import { Button, Input, Switch } from '@vela/ui'
import type { CaptureCoolingView } from '@vela/model/web'

function temperature(value: number) {
  return `${value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 }).replace('-', '−')}°C`
}

export function PreparationCooling({
  cooling, disabled, pending, checking, error, unconfirmed, runActive,
  onCooler, onSetpoint, onCheck,
}: {
  cooling: CaptureCoolingView | null
  disabled: boolean
  pending: boolean
  checking?: boolean
  error: string | null
  unconfirmed: boolean
  runActive?: boolean
  onCooler: (coolerOn: boolean) => void
  onSetpoint: (setpointC: number) => void
  onCheck?: () => void
}) {
  const inputId = useId()
  const [target, setTarget] = useState<string | null>(null)
  const requested = target ?? (cooling?.setpointC === undefined ? '' : String(cooling.setpointC))
  const setpoint = Number(requested)
  const validTarget = requested.trim() !== '' && Number.isFinite(setpoint) && setpoint >= -80 && setpoint <= 50
  const blocked = disabled || unconfirmed

  const coolingToward = cooling?.state === 'on' && cooling.sensorTemperatureC !== undefined &&
    cooling.setpointC !== undefined && cooling.sensorTemperatureC > cooling.setpointC

  return (
    <section className="preparation-cooling" aria-label="Camera cooling">
      <header>
        <h2>Camera cooling</h2>
        <div className="preparation-cooling__switch">
          <span>{cooling ? cooling.state === 'on' ? 'On' : 'Off' : 'Unknown'}</span>
          {cooling && <Switch label="Cooler on" checked={cooling.state === 'on'}
            pending={pending} disabled={blocked} onChange={onCooler} />}
        </div>
      </header>
      <div className="preparation-cooling__reading">
        <strong className="vela-type-metric" aria-label="Sensor temperature">
          {cooling?.sensorTemperatureC === undefined ? '—' : temperature(cooling.sensorTemperatureC)}
        </strong>
        <span>
          {cooling?.setpointC !== undefined
            ? `${coolingToward ? 'Cooling toward' : 'Requested'} ${temperature(cooling.setpointC)}`
            : 'Requested temperature unavailable'}
          {cooling?.powerPercent !== undefined && ` · ${cooling.powerPercent.toLocaleString(undefined, { maximumFractionDigits: 0 })}% power`}
        </span>
      </div>
      {cooling?.canSetTemperature && (
        <form onSubmit={event => {
          event.preventDefault()

          if (!blocked && !pending && validTarget) onSetpoint(setpoint)
        }}>
          <label htmlFor={inputId}>Setpoint</label>
          <div className="capture-preparation__unit-field">
            <Input id={inputId} aria-label="Target temperature · °C" type="number"
              min="-80" max="50" step="0.1" value={requested} disabled={blocked}
              invalid={!validTarget} onChange={event => setTarget(event.target.value)} />
            <span aria-hidden="true">°C</span>
          </div>
          <Button type="submit" disabled={blocked || pending || !validTarget}>Apply</Button>
        </form>
      )}
      {cooling?.canSetTemperature && !validTarget && <p role="status">Choose −80 to 50 °C.</p>}
      {!cooling && <p role="status">Cooling state is unavailable. Waiting for a fresh camera reading.</p>}
      {pending && <p role="status">Confirming cooler state…</p>}
      {unconfirmed && <p role="status">Cooler command outcome unknown. Check the camera before assuming it changed.</p>}
      {error && <p role="status">{error}</p>}
      {unconfirmed && onCheck && (
        <Button type="button" disabled={pending || checking || runActive} onClick={onCheck}>Check camera cooling</Button>
      )}
      <div className="preparation-cooling__footnote">
        <span>Capture can start while cooling.</span>
      </div>
    </section>
  )
}
