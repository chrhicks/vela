import { useState, type CSSProperties, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { Button, Input, Panel, Select, VELA_CURRENT_PROFILE, resolveTheme, themeStyle } from '@vela/ui'
import { useSimulator } from './useSimulator'
import '@vela/ui/styles.css'
import './styles.css'

function angularOffset(value: number) {
  const seconds = Math.round(Math.abs(value))
  return `${seconds >= 60 ? `${Math.floor(seconds / 60)}′ ` : ''}${seconds % 60}″`
}

function Axis({ axis, value, step, disabled, adjust }: {
  axis: 'altitude' | 'azimuth', value: number, step: number, disabled: boolean,
  adjust: (delta: number) => void,
}) {
  const vertical = axis === 'altitude'
  return <section aria-label={`${vertical ? 'Altitude' : 'Azimuth'} adjustment`}>
    <div className="sim-axis-heading"><h2>{vertical ? 'Altitude' : 'Azimuth'}</h2><span>{vertical ? 'Vertical' : 'Horizontal'}</span></div>
    <strong>{angularOffset(value)}</strong>
    <p>{vertical ? value === 0 ? 'At the pole’s altitude' : value > 0 ? 'Above the pole' : 'Below the pole'
      : value === 0 ? 'Pointing north' : value > 0 ? 'East of north' : 'West of north'}</p>
    <div className="sim-buttons">
      <Button tone="neutral" disabled={disabled || value <= -18000} onClick={() => adjust(-step)}>{vertical ? '↓ Lower' : '← West'}</Button>
      <Button tone="neutral" disabled={disabled || value >= 18000} onClick={() => adjust(step)}>{vertical ? '↑ Raise' : 'East →'}</Button>
    </div>
  </section>
}

function Controls() {
  const { state, available, pending, notice, observedAt, command } = useSimulator()
  const [step, setStep] = useState('60')
  const [preset, setPreset] = useState('large-error')
  const [exactOpen, setExactOpen] = useState(false)
  const blocked = !available || pending
  const exposing = state?.cameras.some(camera => camera.activity === 'exposing') ?? false
  const mountBusy = exposing || !!state?.slewing
  const adjust = (altitudeArcsec: number, azimuthArcsec: number) => command('/simulator/adjust', 'PUT',
    { altitudeArcsec, azimuthArcsec }, 'Offsets applied · next exposure uses this position')
  function applyExact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const altitude = Number(fields.get('altitude'))
    const azimuth = Number(fields.get('azimuth'))
    if ([altitude, azimuth].every(value => Number.isInteger(value) && Math.abs(value) <= 18000)) void adjust(altitude, azimuth)
  }
  return <main className="vela-theme sim-page" data-mode="dark" style={themeStyle(resolveTheme(VELA_CURRENT_PROFILE), 'dark') as CSSProperties}>
    <article className="sim-controls" data-pending={pending}>
      <header className="sim-heading"><div><p>Development rig</p><h1>Rig simulator</h1></div><span>{available ? 'Local simulator' : 'Disconnected'}</span></header>
      <p className="sim-intro">Adjust the rig here. Watch Vela respond in its own window.</p>
      <p className="sim-connection">Add rig in Vela: <strong>127.0.0.1:7850</strong>{state ? ` · Mono ${state.cameras[0]?.connected ? 'connected' : 'disconnected'} · Color ${state.cameras[1]?.connected ? 'connected' : 'disconnected'} · Mount ${state.telescopeConnected ? 'connected' : 'disconnected'}` : ''}</p>
      {!available && <p role="status" className="sim-notice">{state ? `Service unavailable. Showing last-known state from ${new Date(observedAt!).toLocaleTimeString()}. Reconnecting…` : 'Waiting for the local simulator service…'}</p>}
      {state && <div className="sim-layout">
        <Panel title="Adjust the mount" description="These controls stand in for the mount’s adjustment knobs.">
          <Select label="Adjustment per press" value={step} onChange={event => setStep(event.target.value)} options={[
            { value: '60', label: 'Coarse · 1 arcminute' }, { value: '5', label: 'Fine · 5 arcseconds' },
          ]} />
          <div className="sim-axes">
            <Axis axis="altitude" value={state.altitudeArcsec} step={Number(step)} disabled={blocked || mountBusy} adjust={delta => void adjust(Math.max(-18000, Math.min(18000, state.altitudeArcsec + delta)), state.azimuthArcsec)} />
            <Axis axis="azimuth" value={state.azimuthArcsec} step={Number(step)} disabled={blocked || mountBusy} adjust={delta => void adjust(state.altitudeArcsec, Math.max(-18000, Math.min(18000, state.azimuthArcsec + delta)))} />
          </div>
          <p className="sim-note">Actual simulated offsets, not Vela’s measured alignment error.</p>
          <div className="sim-status" role="status">{exposing ? 'Exposing image · wait before adjusting the mount' : state.slewing ? 'Mount moving · wait before adjusting' : pending ? 'Applying change…' : notice === 'Connecting to simulator…' ? 'Ready for adjustments' : notice}</div>
          <div className="sim-details">
            <button className="sim-summary" aria-expanded={exactOpen} onClick={() => setExactOpen(!exactOpen)}>{exactOpen ? '▾' : '▸'} Set exact offsets</button>
            {exactOpen && <form onSubmit={applyExact}>
              <Input name="altitude" required label="Altitude · arcseconds" type="number" min={-18000} max={18000} step={1} defaultValue={state.altitudeArcsec} message="Positive is above the pole." />
              <Input name="azimuth" required label="Azimuth · arcseconds" type="number" min={-18000} max={18000} step={1} defaultValue={state.azimuthArcsec} message="Positive is east of north." />
              <Button type="submit" tone="neutral" disabled={blocked || mountBusy}>Apply offsets</Button>
            </form>}
          </div>
        </Panel>
        <div className="sim-side">
          <Panel title="Cameras" description="Choose each camera’s image size for the next exposure.">
            {state.cameras.map(camera => <section className="sim-camera-row" key={camera.number} aria-label={camera.sensor === 'mono' ? 'Mono camera' : 'Color camera'}>
              <div className="sim-camera-title"><h2>{camera.sensor === 'mono' ? 'Mono camera' : 'Color camera'}</h2><span>{camera.connected ? 'Connected' : 'Disconnected'}</span></div>
              <p className="sim-camera-meta">Camera {camera.number} · {camera.sensor === 'mono' ? 'Monochrome' : 'RGGB sensor'}</p>
              <Select label={`${camera.sensor === 'mono' ? 'Mono' : 'Color'} image size`} value={camera.resolution} disabled={blocked || camera.activity === 'exposing'} options={[
                { value: 'fast', label: 'Fast · 1562 × 1044' },
                { value: 'full', label: 'Full · 6248 × 4176' },
              ]} onChange={event => void command('/simulator/camera', 'PUT', { cameraNumber: camera.number, resolution: event.target.value }, `${camera.sensor === 'mono' ? 'Mono' : 'Color'} image size updated for the next exposure`)} />
              <p className="sim-camera-activity" role="status">{camera.activity === 'exposing'
                ? 'Exposing · image size locked until complete'
                : camera.imageReady ? 'Image ready' : 'Idle · no image ready'}</p>
            </section>)}
          </Panel>
          <Panel title="Shared sky" description="Both cameras see the same sky and mount position.">
            <div className="sim-camera"><strong>{state.obscured ? 'Obscured' : 'Clear sky'}</strong><p>{state.obscured ? 'New exposures contain background noise without stars.' : 'New exposures contain the generated star field.'}</p></div>
            <Button tone="neutral" disabled={blocked} onClick={() => void command('/simulator/camera', 'PUT', { obscured: !state.obscured }, 'Shared sky updated for the next exposure')}>{state.obscured ? 'Clear the sky' : 'Obscure the sky'}</Button>
            <p className="sim-camera-note">Applies to the next exposure on either camera.</p>
          </Panel>
          <Panel title="Start again" description="Return to a known setup for another attempt.">
            <Select label="Starting position" value={preset} onChange={event => setPreset(event.target.value)} options={[
              { value: 'large-error', label: 'Large error' }, { value: 'near-aligned', label: 'Nearly aligned' }, { value: 'aligned', label: 'Aligned' },
            ]} />
            <p className="sim-note">Reset stops current work, restores these offsets and clears the camera. Start a fresh alignment measurement in Vela afterward.</p>
            <Button tone="neutral" disabled={blocked} onClick={() => void command('/simulator/reset', 'POST', { preset }, 'Starting position restored · camera clear')}>Reset rig</Button>
          </Panel>
        </div>
      </div>}
    </article>
  </main>
}

createRoot(document.getElementById('root')!).render(<Controls />)
