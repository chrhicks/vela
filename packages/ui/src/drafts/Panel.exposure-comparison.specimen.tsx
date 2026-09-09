import { useState } from 'react'
import type { CSSProperties, PointerEvent } from 'react'
import { Button } from '../components'
import type { ComponentSpecimen } from '../themes'
import { CaptureRunExposure, type CaptureRunConditions } from './CaptureRunExposure'
import './Panel.exposure-comparison.specimen.css'

type Props = Record<string, string | number | boolean>
const names = { clear: 'clear', soft: 'softened stars', haze: 'thin haze', streak: 'a passing streak', changing: 'changing conditions' }

function Comparison({ props, onPropsChange }: { props: Props; onPropsChange?: (patch: Props) => void }) {
  const [local, setLocal] = useState(props)
  const values = onPropsChange ? props : local
  const update = (patch: Props) => onPropsChange ? onPropsChange(patch) : setLocal(current => ({ ...current, ...patch }))
  const [reference, setReference] = useState<{ frame: number; condition: CaptureRunConditions }>({ frame: 12, condition: 'clear' })
  const [holding, setHolding] = useState(false)
  const condition = String(values.condition) as CaptureRunConditions
  const frame = Number(values.frame) || 18
  const x = Math.max(12.5, Math.min(87.5, Number(values.x) || 50))
  const y = Math.max(12.5, Math.min(87.5, Number(values.y) || 50))
  const cropStyle = { '--compare-x': `${x}%`, '--compare-y': `${y}%` } as CSSProperties
  function moveCrop(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    update({ x: Math.max(12.5, Math.min(87.5, (event.clientX - bounds.left) / bounds.width * 100)), y: Math.max(12.5, Math.min(87.5, (event.clientY - bounds.top) / bounds.height * 100)) })
  }
  return <section className="vela-comparison-demo" style={cropStyle} aria-label="Exposure comparison experiment">
    <header><div><p className="vela-comparison-demo__eyebrow">Capture / comparison experiment</p><h1>Has the field changed?</h1><p>Keep a good exposure beside the latest one.</p></div><span className="vela-comparison-demo__synthetic">Synthetic exposures</span></header>
    <div className="vela-comparison-demo__identities"><span>Reference <strong>#{reference.frame} · {names[reference.condition]}</strong></span><span>Latest <strong>#{frame} · {names[condition]}</strong></span></div>
    <div className="vela-comparison-demo__field" onPointerDown={moveCrop}>
      <div hidden={holding}><CaptureRunExposure frame={frame} conditions={condition} /></div>
      <div hidden={!holding}><CaptureRunExposure frame={reference.frame} conditions={reference.condition} /></div>
      <span className="vela-comparison-demo__image-label" role="status">{holding ? `Reference #${reference.frame}` : `Latest #${frame}`}</span>
      <div className="vela-comparison-demo__crop-box" aria-hidden="true" />
    </div>
    <div className="vela-comparison-demo__actions"><Button tone="accent" aria-pressed={holding} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId)
        setHolding(true) }} onPointerUp={() => setHolding(false)} onPointerCancel={() => setHolding(false)} onLostPointerCapture={() => setHolding(false)} onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault()
        setHolding(true) } }} onKeyUp={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault()
        setHolding(false) } }} onBlur={() => setHolding(false)}>Hold to compare</Button><Button tone="quiet" onClick={() => setReference({ frame, condition })}>Pin latest as reference</Button></div>
    <p className="vela-comparison-demo__hint">Hold with a pointer, Space or Enter to reveal the reference. Release to return to the latest exposure. No automatic blinking.</p>
    <div className="vela-comparison-demo__crop-heading"><h2>The same patch, closer</h2><span>Quarter-width crops · same position and scale</span></div>
    <div className="vela-comparison-demo__crops"><figure><div><CaptureRunExposure frame={reference.frame} conditions={reference.condition} /></div><figcaption>Reference #{reference.frame}</figcaption></figure><figure><div><CaptureRunExposure frame={frame} conditions={condition} /></div><figcaption>Latest #{frame}</figcaption></figure></div>
    <div className="vela-comparison-demo__position"><label>Inspect left / right<input type="range" min="12.5" max="87.5" step=".5" value={x} onChange={event => update({ x: Number(event.target.value) })} /></label><label>Inspect up / down<input type="range" min="12.5" max="87.5" step=".5" value={y} onChange={event => update({ y: Number(event.target.value) })} /></label></div>
    <p className="vela-comparison-demo__hint">Tap the field or use the sliders to move both crops together. Compare star shape, background glow and passing trails.</p>
    <aside><label>Try a change<select value={condition} onChange={event => update({ condition: event.target.value, frame: frame + 1 })}>{['clear', 'soft', 'haze', 'streak'].map(value => <option value={value} key={value}>{names[value as CaptureRunConditions]}</option>)}</select></label><p>Illustrative fixtures, not rig imagery. Matched crops assume the same framing; this experiment does not register images or diagnose image quality.</p></aside>
  </section>
}

export const specimen: ComponentSpecimen = {
  componentId: 'panel', componentName: 'Panel / Card', id: 'panel-exposure-comparison', name: 'Exposure comparison · Experiment',
  description: 'Pin a reference, hold to compare, and inspect matching crops for changes in softness, haze or trails. Synthetic local images only.',
  controls: { condition: { type: 'select', label: 'Latest condition', options: ['clear', 'soft', 'haze', 'streak'] }, frame: { type: 'text', label: 'Latest exposure number' }, x: { type: 'text', label: 'Crop horizontal (%)' }, y: { type: 'text', label: 'Crop vertical (%)' } },
  defaultProps: { condition: 'soft', frame: 18, x: 50, y: 50 },
  render: (props, onPropsChange) => <Comparison props={props} {...(onPropsChange ? { onPropsChange } : {})} />,
}
