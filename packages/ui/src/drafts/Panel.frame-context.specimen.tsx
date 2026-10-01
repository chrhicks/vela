import { useRef, useState } from 'react'
import { Button, Dialog, IconButton, Input, NavigationBar, SkyPath } from '../components'
import type { SkyLightPhase } from '../components'
import type { ComponentSpecimen } from '../themes'
import targets from './explore-sky/fixtures.json'
import './Panel.frame-context.specimen.css'

type Props = Record<string, string | number | boolean>

const target = targets.find(subject => subject.id === 'ngc7000')!

const surveyImage = new URL('./frame-context/north-america-survey.jpg', import.meta.url).href

const time = (at: string) => new Date(at).toLocaleTimeString('en-GB', {
  timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
})

function lightPhase(altitude: number): SkyLightPhase {
  if (altitude <= -18) return 'night'

  if (altitude <= -12) return 'astronomical'

  if (altitude <= -6) return 'nautical'

  return altitude < 0 ? 'civil' : 'daylight'
}

const skySamples = target.sky.samples.map(sample => ({
  ...sample,
  light: lightPhase(sample.sunAltitudeDegrees),
  label: time(sample.at),
}))

const snapshotIndex = Math.max(0, target.sky.samples.findIndex(sample => sample.at >= target.sky.observedAt))

function SkyPathIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 19h18M4 15a8 8 0 0 1 10-9" />
      <path d="m17 3 1.1 2.9L21 7l-2.9 1.1L17 11l-1.1-2.9L13 7l2.9-1.1Z" />
      <path d="M20 13v2" />
      <circle cx="4" cy="15" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

function FrameContext({ props, onPropsChange }: {
  props: Props
  onPropsChange?: (patch: Props) => void
}) {
  const [local, setLocal] = useState(props)
  const values = onPropsChange ? props : local

  const update = (patch: Props) => onPropsChange
    ? onPropsChange(patch)
    : setLocal(current => ({ ...current, ...patch }))

  const [position, setPosition] = useState({ x: 50, y: 50 })
  const [zoom, setZoom] = useState(1)
  const [seconds, setSeconds] = useState('2')
  const [focal, setFocal] = useState('400')
  const [savedFocal, setSavedFocal] = useState(400)
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; width: number; height: number } | null>(null)
  const checked = values.state === 'Checked'

  const move = (x: number, y: number) => {
    setPosition({ x: Math.max(25, Math.min(75, x)), y: Math.max(25, Math.min(75, y)) })

    if (checked) update({ state: 'Ready', notice: 'Demo composition adjusted. Run another check to measure it.' })
  }

  const check = (slew: boolean) => update({
    state: 'Checked',
    notice: slew
      ? 'Workshop demo: slew and framing check simulated. No mount moved and no camera exposure was taken.'
      : 'Workshop demo: current-frame check simulated. No camera exposure was taken.',
  })

  const exposureValid = Number(seconds) >= 0.1 && Number(seconds) <= 60
  const selectedIndex = Math.max(0, Math.min(skySamples.length - 1, Number(values.skyIndex)))

  return (
    <article className="vela-frame-context">
      <NavigationBar
        home={{ href: '#', onClick: event => event.preventDefault() }}
        rigs={[{ id: 'askar', name: 'Askar FRA 400' }]}
        currentRigId="askar" onRigChange={() => {}}
        links={['Tonight', 'Explore the sky', 'Photographs'].map(label => ({
          label, href: `#${label.toLowerCase().replaceAll(' ', '-')}`,
          current: label === 'Explore the sky', onClick: event => event.preventDefault(),
        }))}
        utility={<span>Connected</span>}
      />
      <main className="vela-frame-context__main">
        <header className="vela-frame-context__heading">
          <a href="#explore" onClick={event => event.preventDefault()}>← Explore the sky</a>
          <div><h1>Frame North America Nebula</h1><p>NGC 7000 · Askar FRA 400</p></div>
          <div className="vela-frame-context__sky-access">
            <div><span>Through the night</span><small>{Math.round(target.sky.currentAltitudeDegrees)}° above the horizon · {time(target.sky.observedAt)}</small></div>
            <IconButton label="View sky path" icon={<SkyPathIcon />} onClick={() => update({ skyOpen: true })} />
          </div>
        </header>
        <div className="vela-frame-context__layout">
          <section className="vela-frame-context__composition" aria-label="Composition">
            <header className="vela-frame-context__toolbar">
              <span>Reference sky · Desired composition</span>
              <div>
                <Button aria-label="Zoom out" onClick={() => setZoom(value => Math.max(0.75, value / 1.25))}>−</Button>
                <Button aria-label="Zoom in" onClick={() => setZoom(value => Math.min(2, value * 1.25))}>+</Button>
                <Button tone="quiet" onClick={() => setZoom(1)}>Reset view</Button>
              </div>
            </header>
            <div className="vela-frame-context__field">
              <img src={surveyImage} alt="North America Nebula DSS2 reference survey" style={{ transform: `scale(${zoom})` }} />
              <div className="vela-frame-context__legend">□ Desired frame{checked && <span>┄ Last solved frame</span>}</div>
              {checked && <div className="vela-frame-context__solved" style={{ left: `${position.x + 1}%`, top: `${position.y + 1}%`, width: `${45.45 * zoom}%` }} />}
              <div
                className="vela-frame-context__footprint" role="slider" tabIndex={0}
                aria-label="Camera frame position" aria-valuemin={25} aria-valuemax={75} aria-valuenow={position.x}
                aria-valuetext={`Demo frame center ${position.x.toFixed(1)} percent across, ${position.y.toFixed(1)} percent down`}
                style={{ left: `${position.x}%`, top: `${position.y}%`, width: `${45.45 * zoom}%` }}
                onPointerDown={event => {
                  if (event.button !== 0) return
                  const field = event.currentTarget.parentElement!.getBoundingClientRect()
                  drag.current = { x: event.clientX, y: event.clientY, cx: position.x, cy: position.y, width: field.width, height: field.height }
                  event.currentTarget.setPointerCapture(event.pointerId)
                  event.currentTarget.focus()
                }}
                onPointerMove={event => {
                  if (drag.current) move(
                    drag.current.cx + (event.clientX - drag.current.x) / drag.current.width * 100,
                    drag.current.cy + (event.clientY - drag.current.y) / drag.current.height * 100,
                  )
                }}
                onPointerUp={() => { drag.current = null }}
                onPointerCancel={() => { drag.current = null }}
                onLostPointerCapture={() => { drag.current = null }}
                onKeyDown={event => {
                  const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key]

                  if (delta) {
                    event.preventDefault()
                    move(position.x + delta[0]!, position.y + delta[1]!)
                  }
                }}
              ><span>+</span></div>
              <div className="vela-frame-context__hint">Drag the frame to adjust composition</div>
            </div>
            <footer>
              <span>Field from camera geometry · Focal length {savedFocal} mm</span>
              <span>DSS2 color reference survey · <a href="https://archive.stsci.edu/dss/acknowledging.html" target="_blank" rel="noreferrer">Image credit ↗</a></span>
            </footer>
            <details className="vela-frame-context__adjustments">
              <summary>Frame position & controls</summary>
              <div className="vela-frame-context__control-row"><strong>Camera orientation stays fixed</strong><Button tone="quiet" onClick={() => move(50, 50)}>Reset frame</Button></div>
              <div className="vela-frame-context__control-row"><span>Move frame</span><div className="vela-frame-context__nudges">
                {([['←', -1, 0], ['→', 1, 0], ['↑', 0, -1], ['↓', 0, 1]] as const).map(([label, x, y]) => (
                  <Button key={label} aria-label={`Move frame ${label}`} onClick={() => move(position.x + x, position.y + y)}>{label}</Button>
                ))}
              </div></div>
              <p>View controls do not move the mount.</p>
              <details className="vela-frame-context__optics">
                <summary>Optics settings</summary>
                <Input label="Effective focal length (mm)" type="number" min="10" max="20000" value={focal} onChange={event => setFocal(event.target.value)} />
                <Button disabled={!Number.isFinite(Number(focal)) || Number(focal) < 10 || Number(focal) > 20000} onClick={() => {
                  setSavedFocal(Number(focal))
                  update({ notice: 'Workshop demo: focal length saved locally. The reference frame is illustrative.' })
                }}>Save focal length</Button>
              </details>
            </details>
          </section>
          <aside className="vela-frame-context__sidebar">
            <section className="vela-frame-context__result" data-current={checked} aria-label="Your composition">
              <strong>{checked ? 'Framing checked · demo' : 'Ready to frame'}</strong>
              {checked && <div className="vela-frame-context__offset"><strong>1.2′</strong><span>from your desired center · simulated</span></div>}
              {checked && <Button tone="accent" onClick={() => update({ notice: 'Workshop demo: centering would move the mount and verify with a fresh exposure. No command sent.' })}>Center composition</Button>}
              <details>
                <summary>Framing details & state</summary>
                <dl>
                  <div><dt>Exposure</dt><dd>{seconds} s</dd></div>
                  <div><dt>Mount pointing side</dt><dd>Unknown</dd></div>
                  <div><dt>Camera</dt><dd>ZWO ASI2600MC Pro</dd></div>
                  <div><dt>Orientation</dt><dd>{checked ? '0.0° · simulated' : 'Assumed north-up · not measured'}</dd></div>
                  <div><dt>Center (J2000)</dt><dd>{position.x === 50 && position.y === 50 ? '314.8214°, 44.5288°' : 'Adjusted · illustrative position'}</dd></div>
                  <div><dt>Field of view</dt><dd>3.36° × 2.25°</dd></div>
                </dl>
                <p>Automatic centering uses a fresh solve after each correction, to within 0.5′. At most four corrections; stop after two worsening results.</p>
                <p>State snapshot · Oct 1, {time(target.sky.observedAt)}</p>
                <Button onClick={() => update({ notice: 'Workshop snapshot: no live rig state is requested.' })}>Check rig state</Button>
              </details>
            </section>
            <section className="vela-frame-context__exposure" aria-label="Last test exposure">
              <h2>Last test exposure</h2>
              <div>
                <svg viewBox="0 0 48 40" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 11h10l4-6h12l4 6h10v25H4Z" /><circle cx="24" cy="23" r="8" /></svg>
                <h3>{checked ? 'No image in this demo' : 'No test exposure yet'}</h3>
                <p>{checked ? 'The framing result above is simulated.' : 'Check your composition to see the actual camera exposure here.'}</p>
              </div>
            </section>
            <div className="vela-frame-context__commands">
              <div className="vela-frame-context__seconds"><label htmlFor="frame-context-seconds">Test exposure</label><div><Input id="frame-context-seconds" aria-label="Test exposure (seconds)" type="number" min="0.1" max="60" step="0.1" value={seconds} onChange={event => setSeconds(event.target.value)} /><span>seconds</span></div></div>
              {!checked && <Button tone="accent" disabled={!exposureValid} onClick={() => check(true)}>Slew & check</Button>}
              <Button disabled={!exposureValid} onClick={() => check(false)}>Check current frame</Button>
              <p>Takes a new test exposure without moving the mount.</p>
              {checked && <div className="vela-frame-context__continue"><Button tone="quiet" onClick={() => update({ state: 'Ready', notice: '' })}>Adjust composition</Button><Button onClick={() => update({ notice: 'Capture is outside this Frame-only workshop preview.' })}>Continue to capture →</Button></div>}
            </div>
            {values.notice && <p className="vela-frame-context__notice" role="status">{values.notice}</p>}
          </aside>
        </div>
        <footer className="vela-frame-context__context"><span>Workshop snapshot · No device commands</span><span>Emission nebula · 120′ across</span></footer>
      </main>
      <Dialog open={Boolean(values.skyOpen)} onDismiss={() => update({ skyOpen: false })}
        title="North America Nebula · Through the night" description="Snapshot · America/New_York · target and Moon positions"
        dismissLabel="Close sky view" className="vela-frame-context__dialog">
        <SkyPath targetName={target.name} samples={skySamples} moonSamples={target.sky.samples.map(sample => sample.moon)} selectedIndex={selectedIndex}
          onSelectedIndexChange={skyIndex => update({ skyIndex })} nowIndex={snapshotIndex} nowLabel="Snapshot" />
        <p className="vela-frame-context__dialog-note">Light boundaries approximate · 15-minute samples</p>
      </Dialog>
    </article>
  )
}

export const specimen: ComponentSpecimen = {
  componentId: 'panel', componentName: 'Panel / Card', id: 'panel-frame-context',
  name: 'Frame context · Draft product example',
  description: 'Current Frame page with sky access beside its heading, framing details beside the result, and optics inside composition controls. Local illustrative frame and simulated checks only.',
  controls: {
    state: { type: 'select', label: 'Framing state', options: ['Ready', 'Checked'] },
    skyOpen: { type: 'boolean', label: 'Sky dialog open' },
  },
  defaultProps: { state: 'Ready', skyOpen: false, skyIndex: snapshotIndex, notice: '' },
  render: (props, onPropsChange) => <FrameContext props={props} {...(onPropsChange ? { onPropsChange } : {})} />,
}
