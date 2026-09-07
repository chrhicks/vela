import type { TargetPosition, TargetView, TargetsView } from '@vela/model/web'
import { Badge, Button, Input, Panel } from '@vela/ui'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { api } from '../lib/api'
import { isTarget, isTargets } from '../features/targets/validation'
import { SkyPath, skyTime, skyWindow } from '../features/targets/SkyPath'
import { SurveyField } from '../features/targets/SurveyField'
import { useFraming } from '../features/targets/use-framing'
import './targets.css'

function ReferenceImage({ target }: { target: TargetView }) {
  const [failed, setFailed] = useState(false)
  return failed ? <div className="vela-target-no-image"><span aria-hidden="true">◇</span><strong>Reference image unavailable</strong><span>{target.name}</span></div>
    : <img loading="lazy" src={target.thumbnailUrl} alt={`${target.name} reference survey`} onError={() => setFailed(true)} draggable={false} />
}

export function Targets() {
  const { rigId = '', targetId } = useParams()
  return <section className="vela-rig-page"><Link className="vela-rig-page__back" to={`/rigs/${encodeURIComponent(rigId)}/observe`}>← Observe</Link>
    <article className="vela-target-demo"><main className="vela-target-main">
      {targetId ? <TargetComposition key={`${rigId}/${targetId}`} rigId={rigId} targetId={targetId} /> : <TargetBrowser key={rigId} rigId={rigId} />}
    </main></article>
  </section>
}
function TargetBrowser({ rigId }: { rigId: string }) {
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const offset = Math.max(0, Number(params.get('offset')) || 0)
  const [input, setInput] = useState(query)
  const [view, setView] = useState<TargetsView | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  const [skyStale, setSkyStale] = useState(false)
  useEffect(() => { setInput(query) }, [query])
  useEffect(() => {
    const timer = setTimeout(() => { if (input !== query) setParams(input ? { q: input } : {}) }, 250)
    return () => clearTimeout(timer)
  }, [input, query, setParams])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(false); setView(null)
    const fetchTargets = () => api<unknown>(`web/rigs/${encodeURIComponent(rigId)}/targets?q=${encodeURIComponent(query)}&offset=${offset}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) }).then(next => {
      if (!isTargets(next, rigId)) throw new Error('Invalid targets response')
      if (!controller.signal.aborted) { setView(next); setSkyStale(false) }
    }).catch(() => { if (!controller.signal.aborted) { setError(true); setSkyStale(true) } }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    void fetchTargets()
    const timer = setInterval(() => void fetchTargets(), 60000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [rigId, query, offset, retry])
  return <>
    <header className="vela-target-heading"><div><p>{view?.rigName ?? 'Observe'} / Targets</p><h1>What would you like to see?</h1></div></header>
    <p className="vela-target-intro">Find something familiar, or let a picture catch your eye.</p>
    <Input label="Find a target" type="search" placeholder="Name, catalog number, or object type" value={input} onChange={event => setInput(event.target.value)} />
    <div className="vela-target-section-heading"><h2>{query ? 'Search results' : 'Explore tonight'}</h2><span role="status">{loading ? 'Finding targets…' : view ? `${view.total} targets${view.site ? '' : ' · site unavailable'}` : 'Catalog unavailable'}</span></div>
    {skyStale && view && <p role="status">Sky updates interrupted · paths show the last calculation.</p>}
    {error && !view && <Panel><p>Could not load the target catalog.</p><Button onClick={() => setRetry(r => r + 1)}>Try again</Button></Panel>}
    {view?.siteUnavailableReason && <p role="status">{view.siteUnavailableReason}</p>}
    <div className="vela-target-grid">{view?.targets.map(target => <Link key={target.id} className="vela-target-card" to={`/rigs/${encodeURIComponent(rigId)}/observe/targets/${encodeURIComponent(target.id)}`}>
      <div className="vela-target-thumbnail"><ReferenceImage target={target} /><span>{target.kind}</span></div>
      <div className="vela-target-card-copy"><span>{target.catalog}</span><h2>{target.name}</h2><p>{target.kind}{target.sizeArcminutes !== null ? ` · ${target.sizeArcminutes}′ across` : ''}</p><SkyPath sky={target.sky} compact stale={skyStale} /><div className="vela-target-card-bottom"><span>{target.sky ? skyWindow(target.sky) : 'Sky path unavailable'}</span><strong>Frame it →</strong></div></div>
    </Link>)}</div>
    {view?.total === 0 && <Panel><div className="vela-target-empty"><h2>No matching targets</h2><p>Try a name, catalog number, or object type.</p><Button onClick={() => { setInput(''); setParams({}) }}>Clear search</Button></div></Panel>}
    {view && view.total > 24 && <nav className="vela-target-pagination" aria-label="Target pages"><Button disabled={loading || offset === 0} onClick={() => setParams({ ...(query ? { q: query } : {}), offset: String(Math.max(0, offset - 24)) })}>Previous</Button><span>{offset + 1}–{Math.min(offset + 24, view.total)} of {view.total}</span><Button disabled={loading || offset + 24 >= view.total} onClick={() => setParams({ ...(query ? { q: query } : {}), offset: String(offset + 24) })}>Next</Button></nav>}
    <p className="vela-target-footnote">A curated collection to explore. Shading marks astronomical darkness. Obstructions haven’t been mapped; paths don’t account for trees, houses, or pylons.</p>
    <p className="vela-target-footnote">Reference imagery: DSS2 color / CDS. <a href="https://archive.stsci.edu/dss/acknowledging.html" target="_blank" rel="noreferrer">Survey credits ↗</a></p>
    <p className="vela-target-footnote">Catalog adapted from <a href="https://github.com/mattiaverga/OpenNGC/tree/da90466031b0372c896588b85be6016c617e205b" target="_blank" rel="noreferrer">OpenNGC</a> by Mattia Verga and <a href="/third-party/openngc-authors.txt" target="_blank" rel="noreferrer">contributors</a> · <a href="/third-party/openngc-license.txt" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>. Coordinates normalized and selected aliases corrected.</p>
  </>
}

function TargetComposition({ rigId, targetId }: { rigId: string, targetId: string }) {
  const [target, setTarget] = useState<TargetView | null>(null)
  const [skyStale, setSkyStale] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [desired, setDesired] = useState<TargetPosition | null>(null)
  const [adjusting, setAdjusting] = useState(false)
  const [focalLength, setFocalLength] = useState('')
  const [seconds, setSeconds] = useState('2')
  const framing = useFraming(rigId)
  const { view, offline, pending, error, commandUnconfirmed } = framing
  const initialized = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    const controller = new AbortController()
    setLoadError(false)
    const fetchTarget = () => api<unknown>(`web/rigs/${encodeURIComponent(rigId)}/targets/${encodeURIComponent(targetId)}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) }).then(next => {
      if (!isTarget(next) || next.id !== targetId) throw new Error('Invalid target response')
      if (!controller.signal.aborted) { setTarget(next); setSkyStale(false) }
    }).catch(() => { if (!controller.signal.aborted) { setLoadError(true); setSkyStale(true) } })
    void fetchTarget()
    const timer = setInterval(() => void fetchTarget(), 60000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [rigId, targetId, retry])
  useEffect(() => {
    if (!view || !target || initialized.current) return
    initialized.current = true
    setDesired(view.targetId === targetId && view.desired ? view.desired : target)
    setFocalLength(view.focalLengthMm?.toString() ?? '')
    setSeconds(String(view.exposureSeconds))
    heading.current?.focus()
  }, [view, target, targetId])
  const back = <Link className="vela-target-back vela-button" to={`/rigs/${encodeURIComponent(rigId)}/observe/targets`}>← Targets</Link>
  if (!target) return <>{back}<p role="status">{loadError ? 'Could not load this target.' : 'Loading target…'}</p>{loadError && <Button onClick={() => setRetry(r => r + 1)}>Try again</Button>}</>
  const matching = view?.targetId === targetId
  const position = desired ?? target
  const sameComposition = matching && view?.desired?.raDegrees === position.raDegrees && view.desired.decDegrees === position.decDegrees
  const checked = sameComposition && view?.phase === 'checked' && view.checkCurrent && !adjusting
  const locked = !!view?.active || pending || offline || commandUnconfirmed || checked
  const actual = matching ? view?.actual ?? null : null
  const status = offline ? 'Connection interrupted · last known state' : pending ? 'Sending command…' : !view ? 'Loading rig state…' : {
    idle: 'Ready to frame', slewing: 'Slewing to composition', exposing: 'Taking test exposure', solving: 'Solving test exposure', checked: checked ? 'Framing checked' : 'Composition not checked', stopping: 'Stopping framing', stopped: 'Framing stopped', failed: 'Framing not confirmed',
  }[view.phase]
  const exposure = Number(seconds), focal = Number(focalLength)
  return <>{back}
    <header className="vela-target-heading"><div><p>{view?.rigName ?? 'Observe'} / Targets</p><div className="vela-target-identity"><h1 ref={heading} tabIndex={-1}>{target.name}</h1><Badge>{target.catalog}</Badge></div></div></header>
    <div className="vela-target-layout">
      <section className="vela-target-composition" aria-label="Composition"><header><strong>{checked ? 'Check the framing' : 'Compose your image'}</strong><span>{actual ? 'Solid: desired · dashed: last solved exposure' : 'Drag the frame to reposition'}</span></header>
        <SurveyField target={target} desired={position} camera={view?.camera ?? null} actual={actual} locked={locked} onChange={setDesired} />
      </section>
      <aside className="vela-target-sidebar">
        <Panel title="Through the night" description={target.sky ? `Local time · ${skyStale ? "last update" : "now"} ${skyTime(target.sky.observedAt)}` : 'Site unavailable'}><SkyPath sky={target.sky} stale={skyStale} />{skyStale && <p role="status">Sky updates interrupted · last calculation shown.</p>}
          {target.sky && <div className="vela-target-sky-facts"><strong>{skyWindow(target.sky)}</strong><span>{target.sky.highestAltitudeDegrees.toFixed(0)}° highest altitude</span><span>Shading: astronomical darkness</span></div>}
          <p className="vela-target-obstructions">Obstructions unknown</p>
        </Panel>
        <Panel title="Your composition">
          <p className="vela-target-description">{target.kind}{target.sizeArcminutes !== null ? ` · ${target.sizeArcminutes}′ across` : ''}</p>
          <dl className="vela-target-details"><div><dt>Camera</dt><dd>{view?.camera?.name ?? 'Unavailable'}</dd></div><div><dt>Orientation</dt><dd>{actual ? `${actual.rotationDegrees.toFixed(1)}° last measured` : 'Assumed north-up · not measured'}</dd></div><div><dt>Center (J2000)</dt><dd>{position.raDegrees.toFixed(4)}°, {position.decDegrees.toFixed(4)}°</dd></div>{view?.camera && <div><dt>Field of view</dt><dd>{view.camera.fieldWidthDegrees.toFixed(2)}° × {view.camera.fieldHeightDegrees.toFixed(2)}°</dd></div>}</dl>
          <details className="vela-target-settings" open={!view?.focalLengthMm}><summary>Optics settings</summary><Input label="Effective focal length (mm)" type="number" min="10" max="20000" value={focalLength} disabled={locked} onChange={e => setFocalLength(e.target.value)} /><Button disabled={locked || !view || !Number.isFinite(focal) || focal < 10 || focal > 20000} onClick={() => void framing.settings(focal)}>Save focal length</Button></details>
          <div className="vela-target-command">
            <strong role="status">{status}</strong>
            {view && <p>State checked {new Date(view.observedAt).toLocaleTimeString()}</p>}
            {view?.error && <p role="alert">{view.error}</p>}
            {error && <p role="alert">{error}</p>}
            {view?.unavailableReason && <p>{view.unavailableReason}</p>}
            {view?.active && !matching && <p>A framing check for another target is active on this rig.</p>}
            {actual && !checked && <p>This is the last solved exposure. Run a new framing check before continuing to capture.</p>}
            {actual && <p>Last check offset: {actual.offsetArcminutes.toFixed(2)}′. Test exposure {new Date(actual.capturedAt).toLocaleTimeString()}.</p>}
            {view?.active ? <Button disabled={!framing.canStop} onClick={() => void framing.stop()}>Stop framing</Button> : checked ? <>
              <Button tone="accent" disabled={!framing.canStart || !view.canCenter} onClick={() => void framing.center()}>Center & recheck</Button><p>One measured pointing correction, followed by another test exposure.</p>
              <Button disabled={offline || pending || commandUnconfirmed} onClick={() => setAdjusting(true)}>Adjust composition</Button>
              {!offline && !pending && !commandUnconfirmed && <Link className="vela-button vela-button--accent" to={`/rigs/${encodeURIComponent(rigId)}/observe/capture`}>Continue to capture →</Link>}
            </> : <><Input label="Test exposure (seconds)" type="number" min="0.1" max="60" step="0.1" value={seconds} disabled={locked} onChange={e => setSeconds(e.target.value)} /><Button tone="accent" disabled={!framing.canStart || !Number.isFinite(exposure) || exposure < .1 || exposure > 60} onClick={async () => {
              const accepted = await framing.start({ targetId, ...position, exposureSeconds: exposure })
              if (accepted?.targetId === targetId && accepted.desired?.raDegrees === position.raDegrees && accepted.desired.decDegrees === position.decDegrees && (accepted.active || accepted.phase === 'checked' && accepted.checkCurrent)) setAdjusting(false)
            }}>Slew & check</Button></>}
            <Button tone="quiet" disabled={pending || framing.refreshing} onClick={async () => {
              const current = await framing.refresh()
              if (current?.targetId === targetId && current.desired?.raDegrees === position.raDegrees && current.desired.decDegrees === position.decDegrees
                && (current.active || current.phase === 'checked' && current.checkCurrent)) setAdjusting(false)
            }}>Check rig state</Button>
          </div>
        </Panel>
      </aside>
    </div>
  </>
}
