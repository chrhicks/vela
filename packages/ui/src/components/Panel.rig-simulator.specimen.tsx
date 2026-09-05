import { useEffect, useState } from 'react'
import type { ComponentSpecimen } from '../themes'
import { Panel } from './Panel'
import { Button } from './Button'
import { Select } from './Select'
import { Input } from './Input'
import './Panel.rig-simulator.specimen.css'

const presets = { 'large-error': [480, -360], 'near-aligned': [12, -9], aligned: [0, 0] } as const
function offset(value: number) {
  const absolute = Math.abs(value)
  return `${Math.floor(absolute / 60) ? `${Math.floor(absolute / 60)}′ ` : ''}${absolute % 60}″`
}

function SimulatorPreview({ props, onPropsChange }: {
  props: Record<string, string | number | boolean>
  onPropsChange?: (patch: Record<string, string | number | boolean>) => void
}) {
  const initial = String(props.example ?? 'large-error') as keyof typeof presets
  const [example, setExample] = useState(initial)
  const [altitude, setAltitude] = useState<number>(presets[initial]?.[0] ?? 480)
  const [azimuth, setAzimuth] = useState<number>(presets[initial]?.[1] ?? -360)
  const [step, setStep] = useState('60')
  const [covered, setCovered] = useState(props.camera === 'obscured')
  const [notice, setNotice] = useState('Ready for adjustments')
  const [draftAltitude, setDraftAltitude] = useState('480')
  const [draftAzimuth, setDraftAzimuth] = useState('-360')

  useEffect(() => {
    const next = presets[initial] ?? presets['large-error']
    setExample(initial)
    setAltitude(next[0])
    setAzimuth(next[1])
    setNotice('Ready for adjustments')
  }, [initial])
  useEffect(() => setCovered(props.camera === 'obscured'), [props.camera])

  const reset = () => {
    const values = presets[example]
    setAltitude(values[0])
    setAzimuth(values[1])
    setCovered(false)
    setNotice('Starting position restored · camera clear')
    onPropsChange?.({ example, camera: 'clear' })
  }
  const nudge = (axis: 'altitude' | 'azimuth', sign: number) => {
    const change = Number(step) * sign
    const update = (value: number) => Math.max(-18000, Math.min(18000, value + change))
    if (axis === 'altitude') setAltitude(update)
    else setAzimuth(update)
    setNotice(`${axis === 'altitude' ? 'Altitude' : 'Azimuth'} adjusted · next exposure uses this position`)
  }
  const valid = [draftAltitude, draftAzimuth].every(value => value.trim() !== '' && Number.isInteger(Number(value)) && Math.abs(Number(value)) <= 18000)

  return (
    <article className="vela-sim-demo">
      <header className="vela-sim-heading"><div><p>Development rig</p><h1>Rig simulator</h1></div><span>Workshop preview</span></header>
      <p className="vela-sim-intro">Adjust the rig here. Watch Vela respond in its own window.</p>
      <div className="vela-sim-layout">
        <Panel title="Adjust the mount" description="These controls stand in for the mount’s adjustment knobs.">
          <Select label="Adjustment per press" value={step} onChange={event => setStep(event.target.value)} options={[
            { value: '60', label: 'Coarse · 1 arcminute' }, { value: '5', label: 'Fine · 5 arcseconds' },
          ]} />
          <div className="vela-sim-axes">
            <section aria-label="Altitude adjustment"><div className="vela-sim-axis-heading"><h2>Altitude</h2><span>Vertical</span></div>
              <strong>{offset(altitude)}</strong><p>{altitude === 0 ? 'At the pole’s altitude' : altitude > 0 ? 'Above the pole' : 'Below the pole'}</p>
              <div className="vela-sim-buttons"><Button tone="neutral" disabled={altitude <= -18000} onClick={() => nudge('altitude', -1)}>↓ Lower</Button><Button tone="neutral" disabled={altitude >= 18000} onClick={() => nudge('altitude', 1)}>↑ Raise</Button></div>
            </section>
            <section aria-label="Azimuth adjustment"><div className="vela-sim-axis-heading"><h2>Azimuth</h2><span>Horizontal</span></div>
              <strong>{offset(azimuth)}</strong><p>{azimuth === 0 ? 'Pointing north' : azimuth > 0 ? 'East of north' : 'West of north'}</p>
              <div className="vela-sim-buttons"><Button tone="neutral" disabled={azimuth <= -18000} onClick={() => nudge('azimuth', -1)}>← West</Button><Button tone="neutral" disabled={azimuth >= 18000} onClick={() => nudge('azimuth', 1)}>East →</Button></div>
            </section>
          </div>
          <p className="vela-sim-note">Actual simulated offsets, not Vela’s measured alignment error.</p>
          <div className="vela-sim-status" role="status">{notice}</div>
          <details className="vela-sim-details"><summary onClick={() => {
            setDraftAltitude(String(altitude))
            setDraftAzimuth(String(azimuth))
          }}>Set exact offsets</summary>
            <form onSubmit={event => {
              event.preventDefault()
              const fields = new FormData(event.currentTarget)
              const alt = Number(fields.get('altitude'))
              const az = Number(fields.get('azimuth'))
              if (![alt, az].every(value => Number.isInteger(value) && Math.abs(value) <= 18000)) return
              setAltitude(alt)
              setAzimuth(az)
              setNotice('Exact offsets applied · next exposure uses this position')
            }}>
              <Input name="altitude" required label="Altitude · arcseconds" type="number" min={-18000} max={18000} step={1} value={draftAltitude} onInput={event => setDraftAltitude(event.currentTarget.value)} message="Positive is above the pole." />
              <Input name="azimuth" required label="Azimuth · arcseconds" type="number" min={-18000} max={18000} step={1} value={draftAzimuth} onInput={event => setDraftAzimuth(event.currentTarget.value)} message="Positive is east of north." />
              <Button type="submit" tone="neutral" disabled={!valid}>Apply offsets</Button>
            </form>
          </details>
        </Panel>
        <div className="vela-sim-side">
          <Panel title="Camera view" description="Try an exposure without visible stars.">
            <div className="vela-sim-camera"><strong>{covered ? 'Obscured' : 'Clear sky'}</strong><p>{covered ? 'New exposures contain only background noise. A solve should fail.' : 'New exposures contain the generated star field.'}</p></div>
            <Button tone="neutral" onClick={() => {
              setCovered(!covered)
              onPropsChange?.({ camera: covered ? 'clear' : 'obscured' })
            }}>{covered ? 'Clear the camera' : 'Obscure the camera'}</Button>
          </Panel>
          <Panel title="Start again" description="Return to a known setup for another attempt.">
            <Select label="Starting position" value={example} onChange={event => setExample(event.target.value as keyof typeof presets)} options={[
              { value: 'large-error', label: 'Large error' }, { value: 'near-aligned', label: 'Nearly aligned' }, { value: 'aligned', label: 'Aligned' },
            ]} />
            <p className="vela-sim-note">Reset restores these offsets and clears the camera. Start a fresh alignment measurement in Vela afterward.</p>
            <Button tone="neutral" onClick={reset}>Reset rig</Button>
          </Panel>
        </div>
      </div>
      <footer>Interactive design sketch · no running rig, exposures or solver connected</footer>
    </article>
  )
}

export const specimen: ComponentSpecimen = {
  componentId: 'panel', componentName: 'Panel / Card', id: 'panel-rig-simulator',
  name: 'Rig simulator · Product example',
  description: 'Separate simulator controls for mount adjustments, obscured imagery and reset. Local interactive fixtures only; no hardware or simulator service connected. Offsets describe simulation truth, not measured alignment.',
  controls: {
    example: { type: 'select', label: 'Starting example', options: ['large-error', 'near-aligned', 'aligned'] },
    camera: { type: 'select', label: 'Camera view', options: ['clear', 'obscured'] },
  },
  defaultProps: { example: 'large-error', camera: 'clear' },
  render: (props, onPropsChange) => <SimulatorPreview props={props} {...(onPropsChange ? { onPropsChange } : {})} />,
}
