import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComponentSpecimen } from '../themes'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { Panel } from '../components/Panel'
import { Checkbox } from '../components/Checkbox'
import { CaptureRunExposure } from './CaptureRunExposure'
import '../components/Panel.capture.specimen.css'
import './Panel.capture-runs.specimen.css'

const phases = ['idle', 'exposing', 'reading', 'complete', 'stopped', 'failed', 'disconnected'] as const
type Props = Record<string, string | number | boolean>

function CameraMark() {
  return <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <rect x="6" y="12" width="36" height="26" rx="5" />
    <path d="m15 12 3-5h12l3 5M35 19h2" />
    <circle cx="24" cy="25" r="8" /><circle cx="24" cy="25" r="3" />
  </svg>
}

function CaptureRunPreview({ props, onPropsChange }: {
  props: Props
  onPropsChange?: (patch: Props) => void
}) {
  const [localProps, setLocalProps] = useState(props)
  const values = onPropsChange ? props : localProps
  const update = useCallback((patch: Props) => {
    if (onPropsChange) onPropsChange(patch)
    else setLocalProps(current => ({ ...current, ...patch }))
  }, [onPropsChange])
  const screen = String(values.screen)
  const phase = String(values.phase)
  const hasImage = phase === 'complete' || Boolean(values.hasImage)
  const exposure = String(values.exposure ?? '2')
  const seconds = Number(exposure)
  const imageSeconds = Number(values.imageSeconds ?? 2)
  const busy = phase === 'exposing' || phase === 'reading'
  const repeat = Boolean(values.repeat)
  const completed = Math.max(0, Math.floor(Number(values.completed) || 0))
  const frame = Math.max(0, Math.floor(Number(values.frame) || 0))
  const conditions = String(values.conditions ?? 'changing') as 'changing' | 'clear' | 'haze' | 'soft' | 'streak'
  const statistics = String(values.statistics ?? 'measured')
  const starCount = statistics === 'no-stars' ? 0 : conditions === 'haze' ? 78 : 128 + (frame % 7) * 3
  const hfr = conditions === 'soft' ? 3.42 : 2.18 + (frame % 5) * 0.06
  const disconnected = phase === 'disconnected'
  const validExposure = exposure.trim() !== '' && Number.isFinite(seconds) && seconds >= 0.1 && seconds <= 600
  const [playing, setPlaying] = useState(false)
  const [fraction, setFraction] = useState(0)
  const [capturedAt, setCapturedAt] = useState(() => Date.now() - 18_000)
  const [now, setNow] = useState(Date.now)
  const [zoomed, setZoomed] = useState(false)
  const imageWindow = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const previousScreen = useRef(screen)
  const age = Math.max(0, Math.floor((now - capturedAt) / 1000))

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  // Start plays local exposure fixtures. Inspector snapshots and gallery previews stay still.
  useEffect(() => {
    if (!playing) return
    if (phase === 'exposing') {
      const started = performance.now()
      const timer = window.setInterval(() => {
        const progress = Math.min(1, (performance.now() - started) / 4000)
        setFraction(progress)
        if (progress === 1) update({ phase: 'reading' })
      }, 100)
      return () => window.clearInterval(timer)
    }
    if (phase === 'reading') {
      const timer = window.setTimeout(() => {
        setCapturedAt(Date.now())
        setNow(Date.now())
        setFraction(0)
        if (!repeat) setPlaying(false)
        update({ phase: repeat ? 'exposing' : 'complete', hasImage: true, imageSeconds: seconds, completed: completed + 1, frame: frame + 1 })
      }, 800)
      return () => window.clearTimeout(timer)
    }
    setPlaying(false)
  }, [phase, playing, seconds, repeat, completed, frame, update])

  useEffect(() => {
    if (previousScreen.current !== screen) heading.current?.focus()
    previousScreen.current = screen
  }, [screen])

  useEffect(() => {
    const viewport = imageWindow.current
    if (!viewport || !zoomed) return
    viewport.scrollLeft = (1600 - viewport.clientWidth) / 2
    viewport.scrollTop = (1200 - viewport.clientHeight) / 2
  }, [zoomed, screen])

  function startCapture() {
    if (!validExposure || busy || disconnected) return
    setFraction(0)
    setPlaying(true)
    update({ phase: 'exposing', completed: 0 })
  }

  const progress = playing ? fraction : 0.4
  const activity = phase === 'exposing' ? 'Exposing' : phase === 'reading' ? 'Receiving image' : disconnected ? 'Connection interrupted' : phase === 'failed' ? 'Capture stopped · camera error' : phase === 'stopped' ? 'Capture stopped' : phase === 'complete' ? 'Image received' : 'Ready for an exposure'
  const alignmentHref = '?component=panel&specimen=panel-polar-alignment&prop.phase=setup&prop.example=near-aligned'

  const rigContext = <details className="vela-capture-rig">
    <summary><span><i data-offline={disconnected || undefined} />{disconnected ? 'Rig updates interrupted' : 'Camera and mount connected'}</span><span>Device details</span></summary>
    <dl><div><dt>Simulator Color Camera</dt><dd>{disconnected ? 'Last known: connected' : busy ? activity : 'Connected · idle'}</dd></div><div><dt>Simulator Telescope</dt><dd>{disconnected ? 'Last known: tracking' : 'Connected · tracking'}</dd></div></dl>
  </details>

  return <article className="vela-capture-demo vela-capture-run-demo">
    <header className="vela-capture-shell"><strong>Vela</strong><span>Offline rig</span><span>Observe</span></header>
    <main className="vela-capture-main">
      {screen === 'capture' && <Button className="vela-capture-back" tone="quiet" size="small" onClick={() => update({ screen: 'observe' })}>← Observe</Button>}
      <header className="vela-capture-heading">
        <div><p>Offline rig</p><h1 ref={heading} tabIndex={-1}>{screen === 'capture' ? 'Capture' : 'Observe'}</h1></div>
        <Badge tone={disconnected ? 'warning' : busy ? 'accent' : 'positive'}>{disconnected ? 'Last known' : busy ? 'Capturing' : 'Connected'}</Badge>
      </header>

      {screen === 'observe' ? <>
        <p className="vela-capture-intro">{disconnected ? `Waiting for rig updates.${hasImage ? ' Your last image is still available.' : ''}` : busy ? 'Your capture is running. New exposures arrive here.' : 'Your rig is connected. What would you like to do?'}</p>
        {rigContext}
        <div className="vela-capture-hub">
          <Panel className="vela-capture-entry" elevation="raised">
            <div className="vela-capture-entry__preview">
              {hasImage ? <CaptureRunExposure frame={frame} conditions={conditions} /> : <CameraMark />}
              <span>{hasImage ? 'Latest exposure' : 'See what your camera sees'}</span>
            </div>
            <div className="vela-capture-entry__body">
              <h2>Capture</h2>
              <p>Capture images and inspect the latest exposure.</p>
              <div className="vela-capture-entry__status" role="status">{busy ? `${activity} · ${completed} completed` : phase === 'failed' || disconnected || phase === 'stopped' ? activity : hasImage ? `${imageSeconds} s · Color · ${age} s ago` : 'No image captured yet'}</div>
              <Button size="large" tone="accent" onClick={() => update({ screen: 'capture' })}>{busy ? 'View capture' : 'Open capture'} →</Button>
            </div>
          </Panel>
          <Panel className="vela-capture-alignment">
            <div className="vela-capture-alignment__mark" aria-hidden="true">◎</div>
            <h2>Polar alignment</h2>
            <p>Measure your alignment and adjust the mount when you need to.</p>
            <a href={alignmentHref}>Open polar alignment <span aria-hidden="true">→</span></a>
          </Panel>
        </div>
      </> : <>
        {disconnected || phase === 'failed' ? <div className="vela-capture-warning" role="alert">
          <strong>{activity}</strong>
          <p>{disconnected ? 'The run may still be capturing. Waiting for the server to reconnect.' : 'The camera did not return a new image. The run has stopped.'}{hasImage ? ' The last image is kept below.' : ''}</p>
        </div> : null}
        <div className="vela-capture-layout">
          <section className="vela-capture-image" aria-label="Latest image">
            <header><div><h2>Latest image</h2><span>{hasImage ? `${age} s ago${busy || disconnected ? ' · Previous exposure' : ''}` : 'No exposure yet'}</span></div>
              {hasImage && <div className="vela-capture-zoom" aria-label="Image scale"><Button size="small" tone={zoomed ? 'quiet' : 'neutral'} aria-pressed={!zoomed} onClick={() => setZoomed(false)}>Fit</Button><Button size="small" tone={zoomed ? 'neutral' : 'quiet'} aria-pressed={zoomed} onClick={() => setZoomed(true)}>100%</Button></div>}
            </header>
            <div className="vela-capture-image__window" data-zoomed={hasImage && zoomed || undefined} ref={imageWindow} tabIndex={hasImage && zoomed ? 0 : undefined} role={hasImage && zoomed ? 'region' : undefined} aria-label={hasImage && zoomed ? 'Image at 100 percent. Scroll to inspect.' : undefined}>
              {hasImage ? <CaptureRunExposure frame={frame} conditions={conditions} /> : <div className="vela-capture-empty"><CameraMark /><h3>{busy ? 'Taking your first exposure' : 'Your first image starts here'}</h3><p>{busy ? 'You can watch the progress beside this view.' : 'Choose an exposure time, then start capturing to see what the camera sees.'}</p></div>}
            </div>
            {hasImage && <div className="vela-capture-image-statistics">
              <dl aria-label="Image statistics">
                <div><dt>Dimensions</dt><dd>1600 × 1200</dd></div>
                <div><dt title="Detected stars with a reliable measurement">Stars</dt><dd>{statistics === 'unavailable' ? '—' : starCount}</dd></div>
                <div><dt title="Median half-flux radius in native image pixels">HFR · px</dt><dd>{statistics === 'measured' ? hfr.toFixed(2) : '—'}</dd></div>
              </dl>
              {statistics !== 'measured' && <p>{statistics === 'no-stars' ? 'No measurable stars in this image.' : 'Star measurements unavailable for this image.'}</p>}
            </div>}
            {hasImage && <footer><span>{imageSeconds} s <i>·</i> Color</span><span>{zoomed ? 'Scroll to inspect' : 'Display stretched'}</span></footer>}
          </section>

          <Panel className="vela-capture-controls" title="Capture images">
            <div className="vela-capture-camera"><CameraMark /><div><strong>Simulator Color Camera</strong><span>Imaging camera</span></div></div>
            <Input label="Exposure · seconds" type="number" min="0.1" max="600" step="0.1" value={exposure} disabled={busy || disconnected} invalid={!validExposure} message={validExposure ? '' : 'Choose 0.1–600 seconds.'} onChange={event => update({ exposure: event.target.value })} />
            <Checkbox label="Repeat until stopped" checked={repeat} disabled={busy || disconnected} onChange={event => update({ repeat: event.target.checked })} />
            <div className="vela-capture-command">
              {busy ? <Button size="large" onClick={() => { setPlaying(false); update({ phase: 'stopped' }) }}>{repeat ? 'Stop run' : 'Stop exposure'}</Button>
                : <Button size="large" tone="accent" disabled={disconnected || !validExposure} onClick={startCapture}>{repeat ? 'Start run' : 'Take exposure'}</Button>}
            </div>
            {(busy || completed > 0 || phase === 'stopped' || phase === 'failed') && <div className="vela-capture-run-count"><strong>{completed}</strong><span>{completed === 1 ? 'image completed' : 'images completed'}{disconnected ? ' · last known' : ''}</span></div>}
            <div className="vela-capture-progress">
              <div><strong role="status">{activity}</strong>{phase === 'exposing' && <span>{(seconds * progress).toFixed(1)} / {seconds} s</span>}</div>
              {phase === 'exposing' && <progress value={progress} max="1" aria-label="Exposure progress" />}
              <p>{busy ? phase === 'reading' ? repeat ? 'Receiving this exposure before starting the next.' : 'Receiving the completed exposure.' : repeat ? `Exposure ${completed + 1}. Stop cancels the unfinished exposure.` : 'The previous image stays visible until the new one arrives.' : phase === 'stopped' ? 'The last completed image is kept. Start again when ready.' : repeat ? 'Keeps capturing until you stop. You can leave this page during the run.' : 'Take one image and stop.'}</p>
            </div>
          </Panel>

        </div>
        {rigContext}
      </>}
    </main>
    <footer className="vela-capture-prototype">Workshop only · Procedural exposure examples · 4 seconds per exposure, then receiving · No rig commands</footer>
  </article>
}

export const specimen: ComponentSpecimen = {
  componentId: 'panel',
  componentName: 'Panel / Card',
  id: 'panel-capture-runs',
  name: 'Capture runs · Draft product example',
  description: 'Repeated exposures with stable latest-image inspection, completed count and immediate stop. Start plays changing local sky fixtures; inspector states are static. No server run or hardware commands.',
  controls: {
    screen: { type: 'select', label: 'View', options: ['observe', 'capture'] },
    phase: { type: 'select', label: 'Capture state', options: phases },
    hasImage: { type: 'boolean', label: 'Previous image available' },
    exposure: { type: 'text', label: 'Next exposure (seconds)' },
    imageSeconds: { type: 'text', label: 'Previous image exposure (seconds)' },
    repeat: { type: 'boolean', label: 'Repeat until stopped' },
    completed: { type: 'text', label: 'Images completed in run' },
    frame: { type: 'text', label: 'Example frame number' },
    conditions: { type: 'select', label: 'Example sky', options: ['changing', 'clear', 'haze', 'soft', 'streak'] },
    statistics: { type: 'select', label: 'Image measurements', options: ['measured', 'no-stars', 'unavailable'] },
  },
  defaultProps: { screen: 'capture', phase: 'idle', hasImage: true, exposure: '5', imageSeconds: '5', repeat: true, completed: '0', frame: '0', conditions: 'changing', statistics: 'measured' },
  render: (props, onPropsChange) => <CaptureRunPreview props={props} {...(onPropsChange ? { onPropsChange } : {})} />,
}
