import { useEffect, useState } from 'react'
import type { ComponentSpecimen } from '../themes'
import { Panel } from './Panel'
import { Button } from './Button'
import { Select } from './Select'
import './Panel.simulator-cameras.specimen.css'

type Resolution = 'fast' | 'full'
type Camera = {
  number: number
  connected: boolean
  activity: 'idle' | 'exposing'
  imageReady: boolean
  width: number
  height: number
  sensor: 'mono' | 'rggb'
  resolution: Resolution
}
const dimensions = { fast: [1600, 1200], full: [6248, 4176] } as const

function CamerasPreview({ props, onPropsChange }: {
  props: Record<string, string | number | boolean>
  onPropsChange?: (patch: Record<string, string | number | boolean>) => void
}) {
  const [mono, setMono] = useState<Resolution>(props.mono === 'full' ? 'full' : 'fast')
  const [color, setColor] = useState<Resolution>(props.color === 'full' ? 'full' : 'fast')
  const [obscured, setObscured] = useState(props.sky === 'obscured')
  useEffect(() => setMono(props.mono === 'full' ? 'full' : 'fast'), [props.mono])
  useEffect(() => setColor(props.color === 'full' ? 'full' : 'fast'), [props.color])
  useEffect(() => setObscured(props.sky === 'obscured'), [props.sky])
  const available = props.state !== 'unavailable'
  const cameras: Camera[] = [mono, color].map((resolution, number) => ({
    number,
    connected: props.state !== 'disconnected',
    activity: props.state === 'exposing' && number === 1 ? 'exposing' : 'idle',
    imageReady: props.state === 'image-ready',
    width: dimensions[resolution][0],
    height: dimensions[resolution][1],
    sensor: number === 0 ? 'mono' : 'rggb',
    resolution,
  }))
  const exposing = cameras.some(camera => camera.activity === 'exposing')

  return <article className="vela-sim-cameras">
    <header><div><p>Development rig</p><h1>Rig simulator</h1></div><span>Workshop preview</span></header>
    <p className="vela-sim-cameras-intro">Two cameras, one mount. Take exposures from Vela.</p>
    {!available && <p role="status" className="vela-sim-cameras-warning">Simulator unavailable. Last-known state · 32 seconds ago. Reconnecting…</p>}
    <div className="vela-sim-cameras-grid">
      <Panel title="Cameras" description="Choose each camera’s image size for the next exposure.">
        {cameras.map(camera => <section className="vela-sim-camera-row" key={camera.number} aria-label={camera.sensor === 'mono' ? 'Mono camera' : 'Color camera'}>
          <div className="vela-sim-camera-title"><h2>{camera.sensor === 'mono' ? 'Mono camera' : 'Color camera'}</h2><span>{camera.connected ? 'Connected' : 'Disconnected'}</span></div>
          <p className="vela-sim-camera-meta">Camera {camera.number} · {camera.sensor === 'mono' ? 'Monochrome' : 'RGGB sensor'}</p>
          <Select label={`${camera.sensor === 'mono' ? 'Mono' : 'Color'} image size`} value={camera.resolution} disabled={!available || camera.activity === 'exposing'} options={[
            { value: 'fast', label: 'Fast · 1600 × 1200' },
            { value: 'full', label: 'Full · 6248 × 4176' },
          ]} onChange={event => {
            const value = event.target.value as Resolution
            if (camera.number === 0) setMono(value)
            else setColor(value)
            onPropsChange?.({ [camera.number === 0 ? 'mono' : 'color']: value })
          }} />
          <p className="vela-sim-camera-activity" role="status">{camera.activity === 'exposing'
            ? 'Exposing · image size locked until complete'
            : camera.imageReady ? 'Image ready' : 'Idle · no image ready'}</p>
        </section>)}
      </Panel>
      <div className="vela-sim-cameras-side">
        <Panel title="Shared sky" description="Both cameras see the same sky and mount position.">
          <strong>{obscured ? 'Obscured' : 'Clear sky'}</strong>
          <p className="vela-sim-cameras-copy">{obscured ? 'New exposures contain background noise without stars.' : 'New exposures contain the generated star field.'}</p>
          <Button tone="neutral" disabled={!available} onClick={() => {
            setObscured(!obscured)
            onPropsChange?.({ sky: obscured ? 'clear' : 'obscured' })
          }}>{obscured ? 'Clear the sky' : 'Obscure the sky'}</Button>
          <p className="vela-sim-cameras-note">Applies to the next exposure on either camera.</p>
        </Panel>
        <Panel title="Shared mount">
          <p className="vela-sim-cameras-copy">{exposing ? 'Color camera is exposing. Mount adjustments are locked until the exposure completes.' : 'Mount adjustments change the view for both cameras.'}</p>
          <p className="vela-sim-cameras-note">Existing adjustment and reset controls continue here.</p>
        </Panel>
      </div>
    </div>
    <footer>Interactive design sketch · no simulator service or hardware connected</footer>
  </article>
}

export const specimen: ComponentSpecimen = {
  componentId: 'panel', componentName: 'Panel / Card', id: 'panel-simulator-cameras',
  name: 'Simulator cameras · Product example',
  description: 'Two cameras sharing a mount and sky, with separate image sizes and honest exposure and unavailable states. Local fixtures only.',
  controls: {
    state: { type: 'select', label: 'Camera state', options: ['idle', 'exposing', 'image-ready', 'disconnected', 'unavailable'] },
    mono: { type: 'select', label: 'Mono resolution', options: ['fast', 'full'] },
    color: { type: 'select', label: 'Color resolution', options: ['fast', 'full'] },
    sky: { type: 'select', label: 'Shared sky', options: ['clear', 'obscured'] },
  },
  defaultProps: { state: 'idle', mono: 'fast', color: 'fast', sky: 'clear' },
  render: (props, onPropsChange) => <CamerasPreview props={props} {...(onPropsChange ? { onPropsChange } : {})} />,
}
