import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { ComponentSpecimen } from '../themes'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { Panel } from '../components/Panel'
import { targets } from './target-framing/fixtures'
import './Panel.target-framing.specimen.css'

type Props = Record<string, string | number | boolean>
const clamp = (value: number) => Math.max(27, Math.min(73, value))
const position = (value: unknown) => clamp(Number.isFinite(Number(value)) ? Number(value) : 50)

function SkyPath({ peak, culmination, compact = false }: { peak: number, culmination: number, compact?: boolean }) {
  const top = 106 - peak * 1.15
  return <svg className="vela-target-path" viewBox="0 0 320 140" role="img" aria-label={`Illustrative sky path, highest altitude ${peak} degrees. Obstructions unknown.`}>
    {!compact && <><path className="vela-target-gridline" d="M28 32H300 M28 67H300" /><text x="0" y="35">60°</text><text x="0" y="70">30°</text></>}
    <path className="vela-target-horizon" d="M28 106H300" />
    <path className="vela-target-arc" d={`M28 102 C${culmination - 45} 102 ${culmination - 45} ${top} ${culmination} ${top} S${culmination + 65} 102 300 102`} />
    <text x="28" y="129">20:00</text><text x="149" y="129">00:00</text><text x="270" y="129">04:00</text>
    {!compact && <text x="235" y="100">Horizon</text>}
  </svg>
}

function ReferenceImage({ source, name, unavailable }: { source: string, name: string, unavailable: boolean }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [source])
  return unavailable || failed
    ? <div className="vela-target-no-image"><span aria-hidden="true">◇</span><strong>Reference image unavailable</strong><span>{name}</span></div>
    : <img src={source} alt={`${name} reference photograph`} onError={() => setFailed(true)} draggable={false} />
}

function TargetFramingPreview({ props, onPropsChange }: { props: Props, onPropsChange?: (patch: Props) => void }) {
  const [local, setLocal] = useState(props)
  const values = onPropsChange ? props : local
  const update = useCallback((patch: Props) => {
    if (onPropsChange) onPropsChange(patch)
    else setLocal(current => ({ ...current, ...patch }))
  }, [onPropsChange])
  const target = targets.find(item => item.id === values.target) ?? targets[0]!
  const composing = values.screen === 'compose'
  const phase = String(values.phase)
  const busy = phase === 'slewing'
  const checking = phase === 'check'
  const x = position(values.frameX)
  const y = position(values.frameY)
  const query = String(values.query ?? '')
  const matches = targets.filter(item => `${item.name} ${item.catalog} ${item.kind}`.toLowerCase().replace(/\s/g, '').includes(query.toLowerCase().replace(/\s/g, '')))
  const [running, setRunning] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const previousScreen = useRef(composing)
  const drag = useRef<{ x: number, y: number, startX: number, startY: number } | null>(null)

  useEffect(() => {
    if (previousScreen.current !== composing) heading.current?.focus()
    previousScreen.current = composing
  }, [composing])

  useEffect(() => {
    if (!running || !busy) return
    const timer = window.setTimeout(() => {
      update({ phase: values.failSlew ? 'failed' : 'check' })
      setRunning(false)
    }, 1600)
    return () => window.clearTimeout(timer)
  }, [running, busy, values.failSlew, update])

  function moveFrame(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current || busy || checking) return
    const box = event.currentTarget.getBoundingClientRect()
    update({ frameX: clamp(drag.current.x + (event.clientX - drag.current.startX) / box.width * 100), frameY: clamp(drag.current.y + (event.clientY - drag.current.startY) / box.height * 100) })
  }

  const status = busy ? 'Slewing · preview simulation' : checking ? 'Framing check · example offset' : phase === 'failed' ? 'Slew not confirmed' : phase === 'stopped' ? 'Preview stopped' : 'Ready to frame'
  return <article className="vela-target-demo">
    <header className="vela-target-shell"><strong>Vela</strong><span>Askar FRA 400</span><Badge>Workshop preview</Badge></header>
    <main className="vela-target-main">
      {composing && <Button className="vela-target-back" tone="quiet" disabled={busy} onClick={() => update({ screen: 'browse', phase: 'idle' })}>← Targets</Button>}
      <header className="vela-target-heading"><div><p>Observe / Targets</p><h1 ref={heading} tabIndex={-1}>{composing ? target.name : 'What would you like to see?'}</h1></div>{composing && <Badge>{target.catalog}</Badge>}</header>
      {!composing ? <>
        <p className="vela-target-intro">Find something familiar, or let a picture catch your eye.</p>
        <Input label="Find a target" type="search" placeholder="Name, catalog number, or object type" value={query} onChange={event => update({ query: event.target.value })} />
        <div className="vela-target-section-heading"><h2>{query ? 'Search results' : 'Explore tonight'}</h2><span role="status">{matches.length} {matches.length === 1 ? 'target' : 'targets'} · sample sky</span></div>
        <div className="vela-target-grid">
          {matches.map(item => <button key={item.id} className="vela-target-card" onClick={() => update({ target: item.id, screen: 'compose', phase: 'idle', frameX: 50, frameY: 50 })}>
            <div className="vela-target-thumbnail"><ReferenceImage source={item.image} name={item.name} unavailable={Boolean(values.imageUnavailable)} /><span>{item.kind}</span></div>
            <div className="vela-target-card-copy"><span>{item.catalog}</span><h2>{item.name}</h2><p>{item.description}</p><SkyPath peak={item.peak} culmination={item.culmination} compact /><div className="vela-target-card-bottom"><span>{item.window}</span><strong>Frame it <span aria-hidden="true">→</span></strong></div></div>
          </button>)}
        </div>
        {matches.length === 0 && <Panel><div className="vela-target-empty"><h2>No matching sample targets</h2><p>Try M13, Andromeda, or nebula. This sketch contains a small reference collection.</p><Button onClick={() => update({ query: '' })}>Clear search</Button></div></Panel>}
        <p className="vela-target-footnote">Obstructions haven’t been mapped. These example paths don’t account for trees, houses, or pylons.</p>
      </> : <div className="vela-target-layout">
        <section className="vela-target-composition" aria-label="Composition">
          <header><strong>{checking ? 'Check the framing' : 'Compose your image'}</strong><span>{checking ? 'Dashed: example pointing' : 'Drag the frame to reposition'}</span></header>
          <div className="vela-target-field" data-disabled={busy || checking} onPointerDown={event => {
            if (busy || checking || event.button !== 0) return
            event.preventDefault()
            drag.current = { x, y, startX: event.clientX, startY: event.clientY }
            event.currentTarget.setPointerCapture(event.pointerId)
          }} onPointerMove={moveFrame} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}>
            <ReferenceImage source={target.image} name={target.name} unavailable={Boolean(values.imageUnavailable)} />
            <div className="vela-target-frame" style={{ left: `${x}%`, top: `${y}%` }}><span>Camera frame</span><i aria-hidden="true">+</i></div>
            {checking && <div className="vela-target-frame vela-target-frame--actual" style={{ left: `${x + 5}%`, top: `${y - 3}%` }} />}
          </div>
          <footer><span>Reference photograph · illustrative frame, not calibrated</span><a href={target.source} target="_blank" rel="noreferrer">Image credit ↗</a></footer>
          <div className="vela-target-adjustments">
            <div><strong>Camera orientation stays fixed</strong><Button size="small" tone="quiet" disabled={busy || checking} onClick={() => update({ frameX: 50, frameY: 50 })}>Reset frame</Button></div>
            <label>Horizontal position<input aria-label="Horizontal frame position" type="range" min="27" max="73" step="1" value={x} disabled={busy || checking} onChange={event => update({ frameX: Number(event.target.value) })} /></label>
            <label>Vertical position<input aria-label="Vertical frame position" type="range" min="27" max="73" step="1" value={y} disabled={busy || checking} onChange={event => update({ frameY: Number(event.target.value) })} /></label>
          </div>
        </section>
        <aside className="vela-target-sidebar">
          <Panel title="Through the night" description="Illustrative sky · local time">
            <SkyPath peak={target.peak} culmination={target.culmination} />
            <div className="vela-target-sky-facts"><strong>{target.window}</strong><span>{target.peak}° highest altitude · sample values</span></div>
            <p className="vela-target-obstructions">Obstructions unknown</p>
          </Panel>
          <Panel title="Your composition">
            <p className="vela-target-description">{target.description}</p>
            <dl className="vela-target-details"><div><dt>Rig</dt><dd>Askar FRA 400</dd></div><div><dt>Orientation</dt><dd>Fixed · example frame</dd></div><div><dt>Position</dt><dd>{x === 50 && y === 50 ? 'Reference center' : 'Custom composition'}</dd></div></dl>
            <div className="vela-target-command">
              <strong role="status">{status}</strong>
              {checking ? <><p>The dashed frame illustrates a pointing offset. In Vela, a solved test exposure would show where the camera actually landed.</p><Button tone="accent" onClick={() => update({ phase: 'idle' })}>Adjust composition</Button><Button onClick={() => update({ phase: 'idle', frameX: 50, frameY: 50 })}>Start over</Button></>
                : busy ? <><p>Previewing the move to your composition…</p><Button onClick={() => { setRunning(false); update({ phase: 'stopped' }) }}>Stop preview</Button></>
                  : <>{phase === 'failed' && <p>The example mount did not confirm the move. Check its state before sending another command.</p>}{phase === 'stopped' && <p>No hardware was moved.</p>}<Button tone="accent" onClick={() => { setRunning(true); update({ phase: 'slewing' }) }}>{phase === 'failed' ? 'Restart preview' : 'Preview slew & check'}</Button></>}
            </div>
          </Panel>
        </aside>
      </div>}
    </main>
    <details className="vela-target-credits"><summary>Reference image credits</summary>{targets.map(item => <p key={item.id}><a href={item.source} target="_blank" rel="noreferrer">{item.name}</a> — {item.credit}. <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a> · Cropped for display.</p>)}</details>
    <footer className="vela-target-disclaimer">Design sketch · Sample sky and camera geometry · Reference photos, not your exposures · No hardware commands</footer>
  </article>
}

export const specimen: ComponentSpecimen = {
  componentId: 'panel', componentName: 'Panel / Card', id: 'panel-target-framing', name: 'Target selection & framing · Draft product example',
  description: 'Visual target search, illustrative sky paths, and an adjustable fixed-orientation frame. Local preview of slew/check/adjust; no device calls or real visibility calculations.',
  controls: {
    screen: { type: 'select', label: 'View', options: ['browse', 'compose'] },
    target: { type: 'select', label: 'Target', options: targets.map(target => target.id) },
    query: { type: 'text', label: 'Search' },
    phase: { type: 'select', label: 'Slew preview', options: ['idle', 'slewing', 'check', 'stopped', 'failed'] },
    frameX: { type: 'text', label: 'Frame horizontal position (%)' },
    frameY: { type: 'text', label: 'Frame vertical position (%)' },
    imageUnavailable: { type: 'boolean', label: 'Reference image unavailable' },
    failSlew: { type: 'boolean', label: 'Simulate unconfirmed slew' },
  },
  defaultProps: { screen: 'browse', target: 'm13', query: '', phase: 'idle', frameX: 50, frameY: 50, imageUnavailable: false, failSlew: false },
  render: (props, onPropsChange) => <TargetFramingPreview props={props} {...(onPropsChange ? { onPropsChange } : {})} />,
}
