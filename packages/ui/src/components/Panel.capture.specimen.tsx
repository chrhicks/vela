import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComponentSpecimen } from '../themes'
import { Badge } from './Badge'
import { Button } from './Button'
import { Checkbox } from './Checkbox'
import { Input } from './Input'
import { Panel } from './Panel'
import './Panel.capture.specimen.css'

const sampleImage = new URL('./fixtures/capture-star-field.png', import.meta.url).href

const phases = ['idle', 'exposing', 'reading', 'complete', 'stopped', 'failed', 'disconnected'] as const

const coolingStates = ['off-near-setpoint', 'on', 'unconfirmed', 'unavailable', 'none'] as const

type Props = Record<string, string | number | boolean>

function CameraMark() {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="6" y="12" width="36" height="26" rx="5" />
      <path d="m15 12 3-5h12l3 5M35 19h2" />
      <circle cx="24" cy="25" r="8" />
      <circle cx="24" cy="25" r="3" />
    </svg>
  )
}

function CapturePreview({ props, onPropsChange }: {
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
  const disconnected = phase === 'disconnected'
  const validExposure = exposure.trim() !== '' && Number.isFinite(seconds) && seconds >= 0.1 && seconds <= 600
  const [playing, setPlaying] = useState(false)
  const [coolerOn, setCoolerOn] = useState(false)
  const [setpoint, setSetpoint] = useState('5')
  const cooling = String(values.cooling ?? 'off-near-setpoint')
  const showCooling = cooling !== 'none'
  const coolingUnconfirmed = cooling === 'unconfirmed' || cooling === 'unavailable'
  const [fraction, setFraction] = useState(0)
  const [capturedAt, setCapturedAt] = useState(() => Date.now() - 18_000)
  const [now, setNow] = useState(Date.now)
  const [zoomed, setZoomed] = useState(false)
  const imageWindow = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const previousScreen = useRef(screen)
  const age = Math.max(0, Math.floor((now - capturedAt) / 1000))

  useEffect(() => {
    setCoolerOn(cooling === 'on')

    if (cooling === 'off-near-setpoint') setSetpoint('5')
  }, [cooling])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)

    return () => window.clearInterval(timer)
  }, [])

  // Only pressing Take exposure plays the accelerated fixture. Inspector states stay inspectable.
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
        setPlaying(false)
        update({ phase: 'complete', hasImage: true, imageSeconds: seconds })
      }, 800)

      return () => window.clearTimeout(timer)
    }

    setPlaying(false)
  }, [phase, playing, seconds, update])

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

  function takeExposure() {
    if (!validExposure || busy || disconnected) return
    setFraction(0)
    setPlaying(true)
    update({ phase: 'exposing' })
  }

  const progress = playing ? fraction : 0.4
  let activity: string

  if (phase === 'exposing') {
    activity = 'Exposing'
  } else if (phase === 'reading') {
    activity = 'Receiving image'
  } else if (disconnected) {
    activity = 'Connection interrupted'
  } else if (phase === 'failed') {
    activity = 'Exposure failed'
  } else if (phase === 'stopped') {
    activity = 'Exposure stopped'
  } else if (phase === 'complete') {
    activity = 'Image received'
  } else {
    activity = 'Ready for an exposure'
  }

  const alignmentHref = '?component=panel&specimen=panel-polar-alignment&prop.phase=setup&prop.example=near-aligned'
  const autofocusHref = '?component=panel&specimen=panel-autofocus&prop.phase=setup&prop.example=current-focus'

  const rigContext = (
    <details className="vela-capture-rig">
      <summary>
        <span>
          <i data-offline={disconnected || undefined} />
          {disconnected ? 'Rig updates interrupted' : 'Camera and mount connected'}
        </span>
        <span>Device details</span>
      </summary>
      <dl>
        <div>
          <dt>Simulator Camera</dt>
          <dd>{disconnected ? 'Last known: connected' : busy ? activity : 'Connected · idle'}</dd>
        </div>
        <div>
          <dt>Simulator Telescope</dt>
          <dd>{disconnected ? 'Last known: tracking' : 'Connected · tracking'}</dd>
        </div>
      </dl>
    </details>
  )

  return (
    <article className="vela-capture-demo">
      <header className="vela-capture-shell">
        <strong>Vela</strong>
        <span>Offline rig</span>
        <span>Observe</span>
      </header>
      <main className="vela-capture-main">
        {screen === 'capture' && <Button className="vela-capture-back" tone="quiet" size="small" onClick={() => update({ screen: 'observe' })}>← Observe</Button>}
        <header className="vela-capture-heading">
          <div>
            <p>Offline rig</p>
            <h1 ref={heading} tabIndex={-1}>{screen === 'capture' ? 'Capture' : 'Observe'}</h1>
          </div>
          <Badge tone={disconnected ? 'warning' : busy ? 'accent' : 'positive'}>{disconnected ? 'Last known' : busy ? 'Capturing' : 'Connected'}</Badge>
        </header>

        {screen === 'observe' ? (
          <>
            <p className="vela-capture-intro">
              {disconnected
                ? `Waiting for rig updates.${hasImage ? ' Your last image is still available.' : ''}`
                : 'Your rig is connected. What would you like to do?'}
            </p>
            {rigContext}
            <div className="vela-capture-hub">
              <Panel className="vela-capture-entry" elevation="raised">
                <div className="vela-capture-entry__preview">
                  {hasImage ? <img src={sampleImage} alt="Latest completed simulator exposure" /> : <CameraMark />}
                  <span>{hasImage ? 'Latest exposure' : 'See what your camera sees'}</span>
                </div>
                <div className="vela-capture-entry__body">
                  <h2>Capture</h2>
                  <p>Take an exposure and inspect the image.</p>
                  <div className="vela-capture-entry__status" role="status">
                    {busy
                      ? `${activity}…`
                      : phase === 'failed' || disconnected || phase === 'stopped'
                        ? activity
                        : hasImage ? `${imageSeconds} s · Mono · ${age} s ago` : 'No image captured yet'}
                    {showCooling && (
                      <span>
                        {coolingUnconfirmed
                          ? 'Check camera cooling'
                          : coolerOn ? `Cooler on · sensor ${Number(setpoint).toFixed(1)} °C` : 'Cooler off · sensor 4.8 °C'}
                      </span>
                    )}
                  </div>
                  <Button size="large" tone="accent" onClick={() => update({ screen: 'capture' })}>{busy ? 'View capture' : 'Open capture'} →</Button>
                </div>
              </Panel>
              <Panel className="vela-capture-alignment">
                <div className="vela-capture-alignment__mark" aria-hidden="true">◎</div>
                <h2>Polar alignment</h2>
                <p>Measure your alignment and adjust the mount when you need to.</p>
                <a href={alignmentHref}>
                  {'Open polar alignment '}
                  <span aria-hidden="true">→</span>
                </a>
              </Panel>
              <Panel className="vela-capture-alignment">
                <div className="vela-capture-alignment__mark" aria-hidden="true">V</div>
                <h2>Autofocus</h2>
                <p>Walk a small window around the current focuser position and watch the V-curve as shorts land.</p>
                <a href={autofocusHref}>
                  {'Open autofocus '}
                  <span aria-hidden="true">→</span>
                </a>
              </Panel>
            </div>
          </>
        ) : (
          <>
            {disconnected || phase === 'failed' ? (
              <div className="vela-capture-warning" role="alert">
                <strong>{activity}</strong>
                <p>
                  {disconnected
                    ? 'Capture status is unknown. Waiting for the rig to reconnect.'
                    : 'The camera did not return a new image.'}
                  {hasImage ? ' The last image is kept below.' : ''}
                </p>
              </div>
            ) : null}
            <div className="vela-capture-layout">
              <section className="vela-capture-image" aria-label="Latest image">
                <header>
                  <div>
                    <h2>Latest image</h2>
                    <span>{hasImage ? `${age} s ago${busy || disconnected ? ' · Previous exposure' : ''}` : 'No exposure yet'}</span>
                  </div>
                  {hasImage && (
                    <div className="vela-capture-zoom" aria-label="Image scale">
                      <Button
                        size="small"
                        tone={zoomed ? 'quiet' : 'neutral'}
                        aria-pressed={!zoomed}
                        onClick={() => setZoomed(false)}
                      >
                        Fit
                      </Button>
                      <Button
                        size="small"
                        tone={zoomed ? 'neutral' : 'quiet'}
                        aria-pressed={zoomed}
                        onClick={() => setZoomed(true)}
                      >
                        100%
                      </Button>
                    </div>
                  )}
                </header>
                <div
                  className="vela-capture-image__window"
                  data-zoomed={hasImage && zoomed || undefined}
                  ref={imageWindow}
                  tabIndex={hasImage && zoomed ? 0 : undefined}
                  role={hasImage && zoomed ? 'region' : undefined}
                  aria-label={hasImage && zoomed ? 'Image at 100 percent. Scroll to inspect.' : undefined}
                >
                  {hasImage ? (
                    <img
                      src={sampleImage}
                      width="1600"
                      height="1200"
                      alt="Monochrome simulator exposure showing a dense star field"
                    />
                  ) : (
                    <div className="vela-capture-empty">
                      <CameraMark />
                      <h3>{busy ? 'Taking your first exposure' : 'Your first image starts here'}</h3>
                      <p>
                        {busy
                          ? 'You can watch the progress beside this view.'
                          : 'Choose an exposure time, then take an image to check what the camera sees.'}
                      </p>
                    </div>
                  )}
                </div>
                {hasImage && (
                  <footer>
                    <span>
                      {imageSeconds}
                      {' s '}
                      <i>·</i>
                      {' Mono '}
                      <i>·</i>
                      {' 1600 × 1200'}
                    </span>
                    <span>{zoomed ? 'Scroll to inspect' : 'Display stretched'}</span>
                  </footer>
                )}
              </section>

              <Panel className="vela-capture-controls" title="Take an exposure">
                <div className="vela-capture-camera">
                  <CameraMark />
                  <div>
                    <strong>Simulator Camera</strong>
                    <span>Monochrome · 1600 × 1200</span>
                  </div>
                </div>
                {showCooling && (
                  <section className="vela-capture-cooling" aria-label="Camera cooling">
                    <h3>Cooling</h3>
                    {cooling === 'unavailable' ? <p>Cooling state is unavailable. Waiting for a fresh camera reading.</p> : (
                      <dl>
                        <div>
                          <dt>Cooler</dt>
                          <dd data-state={coolerOn ? 'on' : 'off'}>{coolerOn ? 'On' : 'Off'}</dd>
                        </div>
                        <div>
                          <dt>Sensor</dt>
                          <dd>{coolerOn ? `${Number(setpoint).toFixed(1)} °C` : '4.8 °C'}</dd>
                        </div>
                        <div>
                          <dt>Requested</dt>
                          <dd>{Number(setpoint).toFixed(1)} °C</dd>
                        </div>
                        <div>
                          <dt>Power</dt>
                          <dd>{coolerOn ? '18%' : '0%'}</dd>
                        </div>
                      </dl>
                    )}
                    <p>
                      {coolingUnconfirmed
                        ? 'Cooler command outcome unknown. Check the camera before assuming it changed.'
                        : coolerOn
                          ? 'Cooler is on. Power shows cooling effort, not a finished temperature.'
                          : 'Cooler is off. A sensor near the requested temperature is not confirmation that cooling is running.'}
                    </p>
                    {cooling !== 'unavailable' && (
                      <>
                        <Checkbox
                          label="Cooler on"
                          description="The specimen does not turn this on by itself."
                          checked={coolerOn}
                          disabled={busy || disconnected || coolingUnconfirmed}
                          onChange={event => setCoolerOn(event.target.checked)}
                        />
                        <Input
                          label="Target temperature · °C"
                          type="number"
                          value={setpoint}
                          disabled={busy || disconnected || coolingUnconfirmed}
                          onChange={event => setSetpoint(event.target.value)}
                          message="Sets the requested temperature only. Turn the cooler on separately."
                        />
                      </>
                    )}
                    {coolingUnconfirmed && (
                      <Button
                        disabled={busy}
                        onClick={() => {
                          if (cooling !== 'unavailable') update({ cooling: 'off-near-setpoint' })
                        }}
                      >
                        Check camera cooling
                      </Button>
                    )}
                  </section>
                )}
                <Input
                  label="Exposure · seconds"
                  type="number"
                  min="0.1"
                  max="600"
                  step="0.1"
                  value={exposure}
                  disabled={busy || disconnected}
                  invalid={!validExposure}
                  message={validExposure ? '' : 'Choose 0.1–600 seconds.'}
                  onChange={event => update({ exposure: event.target.value })}
                />
                <div className="vela-capture-command">
                  {phase === 'exposing' ? (
                    <Button
                      size="large"
                      onClick={() => {
                        setPlaying(false)
                        update({ phase: 'stopped' })
                      }}
                    >
                      Stop exposure
                    </Button>
                  )
                  : (
                    <Button
                      size="large"
                      tone="accent"
                      disabled={phase === 'reading' || disconnected || !validExposure}
                      onClick={takeExposure}
                    >
                      {phase === 'reading' ? 'Receiving image…' : 'Take exposure'}
                    </Button>
                  )}
                </div>
                <div className="vela-capture-progress">
                  <div>
                    <strong role="status">{activity}</strong>
                    {phase === 'exposing' && <span>{(seconds * progress).toFixed(1)} / {seconds} s</span>}
                  </div>
                  {phase === 'exposing' && <progress value={progress} max="1" aria-label="Exposure progress" />}
                  <p>
                    {busy
                      ? hasImage
                        ? 'The previous image stays visible until the new one arrives.'
                        : 'The image will appear when the exposure is received.'
                      : phase === 'stopped' ? 'No new image was added.' : 'One exposure at a time. The latest image stays here.'}
                  </p>
                </div>
              </Panel>

            </div>
            {rigContext}
          </>
        )}
      </main>
      <footer className="vela-capture-prototype">Workshop only · Fixed simulator image · Exposures preview in 4 seconds · No rig commands</footer>
    </article>
  )
}

export const specimen: ComponentSpecimen = {
  componentId: 'panel',
  componentName: 'Panel / Card',
  id: 'panel-capture',
  name: 'Observe & capture · Product example',
  description: 'Observe hub → capture prep with confirmed cooler state → latest image. Near-setpoint sensor temperature is not treated as cooler-on. A local four-second preview uses a fixed simulator image; no rig commands.',
  controls: {
    screen: { type: 'select', label: 'View', options: ['observe', 'capture'] },
    phase: { type: 'select', label: 'Capture state', options: phases },
    cooling: { type: 'select', label: 'Cooling', options: coolingStates },
    hasImage: { type: 'boolean', label: 'Previous image available' },
    exposure: { type: 'text', label: 'Next exposure (seconds)' },
    imageSeconds: { type: 'text', label: 'Previous image exposure (seconds)' },
  },
  defaultProps: {
    screen: 'observe',
    phase: 'idle',
    cooling: 'off-near-setpoint',
    hasImage: false,
    exposure: '2',
    imageSeconds: '2'
  },
  render: (props, onPropsChange) => <CapturePreview props={props} {...(onPropsChange ? { onPropsChange } : {})} />,
}
