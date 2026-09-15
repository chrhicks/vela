import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { ComponentSpecimen } from '../themes'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Dialog } from '../components/Dialog'
import { SkyPath as OverheadSkyPath } from '../components'
import { getSkySamples, getDemoHorizon, getMoonSamples } from '../components/sky-path/fixtures'
import { Input } from '../components/Input'
import { Panel } from '../components/Panel'
import { targets } from './target-framing/fixtures'
import './Panel.target-framing.specimen.css'

type Props = Record<string, string | number | boolean>

const clamp = (value: number) => Math.max(27, Math.min(73, value))

const position = (value: Props[string] | undefined) => clamp(Number.isFinite(Number(value)) ? Number(value) : 50)

function CompactSkyPath({ targetId, nowIndex }: { targetId: string, nowIndex: number }) {
  const samples = getSkySamples(targetId)
  const x = (index: number) => 28 + index / (samples.length - 1) * 272
  const y = (altitude: number) => Math.max(24, Math.min(116, 106 - altitude * .9))

  return <svg className="vela-target-path" viewBox="0 0 320 140" role="img" aria-label="Sample altitude through the night. Local obstructions not included.">
    <path className="vela-target-horizon" d="M28 106H300" />
    <polyline className="vela-target-arc" points={samples.map((sample, index) => `${x(index)},${y(sample.altitudeDegrees)}`).join(' ')} />
    <g className="vela-target-time"><line x1={x(nowIndex)} x2={x(nowIndex)} y1="24" y2="106" /><text x={x(nowIndex)} y="17" textAnchor="middle">Now</text></g>
    <text x="28" y="129">20:00</text><text x="149" y="129">00:00</text><text x="270" y="129">04:00</text>
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
  const busy = phase === 'slewing' || phase === 'exposing' || phase === 'settling'
  const checking = phase === 'check'
  const hasCheck = checking || phase === 'adjusting'
  const x = position(values.frameX)
  const y = position(values.frameY)
  const query = String(values.query ?? '')
  const sampleTime = ['21:00', '23:00', '01:00', '03:00'].includes(String(values.sampleTime)) ? String(values.sampleTime) : '23:00'
  const matches = targets.filter(item => `${item.name} ${item.catalog} ${item.kind}`.toLowerCase().replace(/\s/g, '').includes(query.toLowerCase().replace(/\s/g, '')))
  const nowIndex = ((Number(sampleTime.slice(0, 2)) + 4) % 24) * 6
  const skyExpanded = composing && Boolean(values.skyExpanded)
  const skySamples = getSkySamples(target.id)
  const horizon = getDemoHorizon(String(values.horizon ?? 'none'))

  const skyProps = {
    samples: skySamples,
    moonSamples: getMoonSamples()!,
    targetName: target.name,
    selectedIndex: Number(values.skyIndex ?? 18),
    onSelectedIndexChange: (index: number) => update({ skyIndex: index }),
    nowIndex,
    marginDegrees: Number(values.skyMargin ?? 3),
    onMarginDegreesChange: (margin: number) => update({ skyMargin: margin }),
  }

  const displaySky = horizon ? { ...skyProps, horizon } : skyProps
  const example = useRef<HTMLDivElement>(null)

  function expandSky() {
    update({ skyExpanded: true })
    requestAnimationFrame(() => example.current?.scrollIntoView({ block: 'start' }))
  }

  function dismissSky() {
    update({ skyExpanded: false })
    requestAnimationFrame(() => example.current?.querySelector('[data-expand-sky]')?.scrollIntoView({ block: 'nearest' }))
  }

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
      update({ phase: phase === 'slewing' && values.failSlew ? 'failed' : 'check' })
      setRunning(false)
    }, 1600)

    return () => window.clearTimeout(timer)
  }, [running, busy, phase, values.failSlew, update])

  function moveFrame(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current || busy || checking) return
    const box = event.currentTarget.getBoundingClientRect()
    update({ frameX: clamp(drag.current.x + (event.clientX - drag.current.startX) / box.width * 100), frameY: clamp(drag.current.y + (event.clientY - drag.current.startY) / box.height * 100) })
  }

  const status = phase === 'exposing' ? 'Taking test exposure · preview simulation' : phase === 'settling' ? 'Waiting for the mount to settle' : busy ? 'Slewing · preview simulation' : checking ? 'Framing check · example offset' : phase === 'failed' ? 'Slew not confirmed' : phase === 'stopped' ? 'Preview stopped' : 'Ready to frame'

  return <div className="vela-target-example" data-expanded={skyExpanded} ref={example}><article className="vela-target-demo" inert={skyExpanded}>
    <header className="vela-target-shell"><strong>Vela</strong><span>Askar FRA 400</span><Badge>Workshop preview</Badge></header>
    <main className="vela-target-main">
      {composing && <Button className="vela-target-back" tone="quiet" disabled={busy} onClick={() => update({ screen: 'browse', phase: 'idle' })}>← Targets</Button>}
      <header className="vela-target-heading"><div><p>Observe / Targets</p><div className="vela-target-identity"><h1 ref={heading} tabIndex={-1}>{composing ? target.name : 'What would you like to see?'}</h1>{composing && <Badge>{target.catalog}</Badge>}</div></div></header>
      {!composing ? <>
        <p className="vela-target-intro">Find something familiar, or let a picture catch your eye.</p>
        <Input label="Find a target" type="search" placeholder="Name, catalog number, or object type" value={query} onChange={event => update({ query: event.target.value })} />
        <div className="vela-target-section-heading"><h2>{query ? 'Search results' : 'Explore tonight'}</h2><span role="status">{matches.length} {matches.length === 1 ? 'target' : 'targets'} · sample sky</span></div>
        <div className="vela-target-grid">
          {matches.map(item => <button key={item.id} className="vela-target-card" onClick={() => update({ target: item.id, screen: 'compose', phase: 'idle', frameX: 50, frameY: 50 })}>
            <div className="vela-target-thumbnail"><ReferenceImage source={item.image} name={item.name} unavailable={Boolean(values.imageUnavailable)} /><span>{item.kind}</span></div>
            <div className="vela-target-card-copy"><span>{item.catalog}</span><h2>{item.name}</h2><p>{item.description}</p><CompactSkyPath targetId={item.id} nowIndex={nowIndex} /><div className="vela-target-card-bottom"><span>{item.window}</span><strong>Frame it <span aria-hidden="true">→</span></strong></div></div>
          </button>)}
        </div>
        {matches.length === 0 && <Panel><div className="vela-target-empty"><h2>No matching sample targets</h2><p>Try M13, Andromeda, or nebula. This sketch contains a small reference collection.</p><Button onClick={() => update({ query: '' })}>Clear search</Button></div></Panel>}
        <p className="vela-target-footnote">The small charts compare sample altitude. Open a target to inspect its overhead path and optional horizon.</p>
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
            {hasCheck && <div className="vela-target-frame vela-target-frame--actual" style={{ left: `${x + 5}%`, top: `${y - 3}%` }} />}
          </div>
          <footer><span>Reference photograph · illustrative frame, not calibrated</span><a href={target.source} target="_blank" rel="noreferrer">Image credit ↗</a></footer>
          <div className="vela-target-adjustments">
            <div><strong>Camera orientation stays fixed</strong><Button size="small" tone="quiet" disabled={busy || checking} onClick={() => update({ frameX: 50, frameY: 50 })}>Reset frame</Button></div>
            <label>Horizontal position<input aria-label="Horizontal frame position" type="range" min="27" max="73" step="1" value={x} disabled={busy || checking} onChange={event => update({ frameX: Number(event.target.value) })} /></label>
            <label>Vertical position<input aria-label="Vertical frame position" type="range" min="27" max="73" step="1" value={y} disabled={busy || checking} onChange={event => update({ frameY: Number(event.target.value) })} /></label>
          </div>
        </section>
        <aside className="vela-target-sidebar">
          <Panel title="Through the night" description={`Sample night · now ${sampleTime}`}>
            <OverheadSkyPath {...displaySky} compact />
            <Button className="vela-target-expand-sky" size="small" tone="quiet" data-expand-sky onClick={expandSky}>Expand sky view</Button>
          </Panel>
          <Panel title="Your composition">
            <p className="vela-target-description">{target.description}</p>
            <dl className="vela-target-details"><div><dt>Rig</dt><dd>Askar FRA 400</dd></div><div><dt>Orientation</dt><dd>Fixed · example frame</dd></div><div><dt>Position</dt><dd>{x === 50 && y === 50 ? 'Reference center' : 'Custom composition'}</dd></div></dl>
            <div className="vela-target-command">
              <strong role="status">{status}</strong>
              {checking ? <><p>The dashed frame illustrates a pointing offset. In Vela, a solved test exposure would show where the camera actually landed.</p><Button tone="accent" onClick={() => update({ phase: 'adjusting' })}>Adjust composition</Button><Button onClick={() => update({ phase: 'idle', frameX: 50, frameY: 50 })}>Start over</Button></>
                : busy ? <><p>Previewing the move to your composition…</p><Button onClick={() => { setRunning(false); update({ phase: 'stopped' }) }}>Stop preview</Button></>
                  : <>{phase === 'adjusting' && <><Button tone="accent" onClick={() => { setRunning(true); update({ phase: 'slewing' }) }}>Center &amp; recheck</Button><p>Move to your edited composition using the last measured pointing correction.</p></>}{phase === 'failed' && <p>The example mount did not confirm the move. Check its state before sending another command.</p>}{phase === 'stopped' && <p>No hardware was moved.</p>}<Button tone="accent" onClick={() => { setRunning(true); update({ phase: 'slewing' }) }}>{phase === 'failed' ? 'Restart preview' : 'Preview slew & check'}</Button></>}
              {!busy && <><Button onClick={() => { setRunning(true); update({ phase: 'exposing' }) }}>Check current frame</Button><p>Take a test exposure at the current position without moving the mount.</p></>}
            </div>
          </Panel>
        </aside>
      </div>}
    </main>
    <section className="vela-target-credits" aria-label="Reference image credits"><h2>Reference image credits</h2>{targets.map(item => <p key={item.id}><a href={item.source} target="_blank" rel="noreferrer">{item.name}</a> — {item.credit}. <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a> · Cropped for display.</p>)}</section>
    <footer className="vela-target-disclaimer">Design sketch · Sample sky and camera geometry · Reference photos, not your exposures · No hardware commands</footer>
  </article>
    <Dialog open={skyExpanded} onDismiss={dismissSky} title={`${target.name} · Through the night`} description="Sample night · imaginary observing site" className="vela-target-sky-dialog" dismissLabel="Close sky view">
      <OverheadSkyPath {...displaySky} />
    </Dialog>
  </div>
}

export const specimen: ComponentSpecimen = {
  componentId: 'panel', componentName: 'Panel / Card', id: 'panel-target-framing', name: 'Target selection & framing · Draft product example',
  description: 'Visual target search, illustrative sky paths, and an adjustable fixed-orientation frame. Overhead sky paths with optional synthetic horizons and an expanded view; local preview of slew/check/adjust, with no device calls or real visibility calculations.',
  controls: {
    screen: { type: 'select', label: 'View', options: ['browse', 'compose'] },
    target: { type: 'select', label: 'Target', options: targets.map(target => target.id) },
    query: { type: 'text', label: 'Search' },
    sampleTime: { type: 'select', label: 'Sample current time', options: ['21:00', '23:00', '01:00', '03:00'] },
    horizon: { type: 'select', label: 'Horizon profile', options: ['none', 'local', 'incomplete', 'uncalibrated'] },
    skyIndex: { type: 'text', label: 'Sky time sample (0–48)' },
    skyMargin: { type: 'text', label: 'Silhouette margin (degrees)' },
    skyExpanded: { type: 'boolean', label: 'Expanded sky view' },
    phase: { type: 'select', label: 'Slew preview', options: ['idle', 'slewing', 'settling', 'exposing', 'check', 'adjusting', 'stopped', 'failed'] },
    frameX: { type: 'text', label: 'Frame horizontal position (%)' },
    frameY: { type: 'text', label: 'Frame vertical position (%)' },
    imageUnavailable: { type: 'boolean', label: 'Reference image unavailable' },
    failSlew: { type: 'boolean', label: 'Simulate unconfirmed slew' },
  },
  defaultProps: { horizon: 'none', skyIndex: 18, skyMargin: 3, skyExpanded: false, sampleTime: '23:00', screen: 'browse', target: 'm13', query: '', phase: 'idle', frameX: 50, frameY: 50, imageUnavailable: false, failSlew: false },
  render: (props, onPropsChange) => <TargetFramingPreview props={props} {...(onPropsChange ? { onPropsChange } : {})} />,
}
