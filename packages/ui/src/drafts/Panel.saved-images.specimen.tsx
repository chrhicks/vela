import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComponentSpecimen } from '../themes'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Checkbox } from '../components/Checkbox'
import { Input } from '../components/Input'
import { Panel } from '../components/Panel'
import { CaptureRunExposure } from './CaptureRunExposure'
import '../components/Panel.capture.specimen.css'
import './Panel.capture-runs.specimen.css'
import './Panel.saved-images.specimen.css'

type Props = Record<string, string | number | boolean>

function SavedImagesPreview({ props, onPropsChange }: { props: Props, onPropsChange?: (patch: Props) => void }) {
  function pageTitle() {
    switch (screen) {
      case 'observe':
        return 'Observe'
      case 'capture':
        return 'Capture'
      case 'detail':
        return 'Saved image'
      default:
        return 'Saved images'
    }
  }

  function renderPageAction() {
    switch (screen) {
      case 'capture':
        return <Button onClick={() => update({ screen: 'saved' })}>Saved images ({saved.length}) →</Button>
      case 'observe':
        return <Badge tone="positive">Connected</Badge>
      default:
        return <span className="vela-saved-count">{saved.length} {saved.length === 1 ? 'image' : 'images'}</span>
    }
  }

  const [local, setLocal] = useState(props)
  const values = onPropsChange ? props : local

  const update = useCallback((patch: Props) => {
    if (onPropsChange) onPropsChange(patch)
    else setLocal(current => ({ ...current, ...patch }))
  }, [onPropsChange])

  const screen = String(values.screen)
  const state = String(values.state)
  const busy = state === 'capturing'
  const hasImage = Boolean(values.hasImage)
  const frame = Math.max(5, Number(values.frame) || 5)
  const selected = Number(values.selected) || frame
  const saved = String(values.saved).split(',').map(Number).filter(id => id > 0)
  const isSaved = saved.includes(frame)
  const exposures = Object.fromEntries(String(values.exposures ?? '').split(',').filter(Boolean).map(entry => entry.split(':')))
  const exposureFor = (id: number) => exposures[id] ?? (id === frame ? String(values.imageSeconds) : '10')
  const seconds = Number(values.exposure)
  const validExposure = Number.isFinite(seconds) && seconds >= 0.1 && seconds <= 600
  const [playing, setPlaying] = useState(false)
  const [notice, setNotice] = useState('')
  const [zoomed, setZoomed] = useState(false)
  const imageWindow = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const previousScreen = useRef(screen)
  const saveList = (id: number) => [...new Set([id, ...saved])].sort((a, b) => b - a).join(',')

  useEffect(() => {
    if (!playing || !busy) return

    const timer = window.setTimeout(() => {
      const next = frame + 1
      const failed = Boolean(values.saveFrames) && Boolean(values.saveFailure)
      update({
        frame: next,
        hasImage: true,
        imageSeconds: seconds,
        exposures: Object.entries({
          ...exposures,
          [frame]: exposureFor(frame),
          [next]: String(seconds),
        }).map(([id, duration]) => `${id}:${duration}`).join(','),
        saved: values.saveFrames && !failed ? saveList(next) : String(values.saved),
        state: failed ? 'save-error' : values.repeat ? 'capturing' : 'idle',
      })

      if (failed || !values.repeat) setPlaying(false)
    }, 3000)

    return () => window.clearTimeout(timer)
  }, [
    playing,
    busy,
    frame,
    seconds,
    values.saveFrames,
    values.saveFailure,
    values.repeat,
    values.saved,
    values.exposures,
    update
  ])

  useEffect(() => {
    if (previousScreen.current !== screen) heading.current?.focus()
    previousScreen.current = screen
    setNotice('')
  }, [screen])

  useEffect(() => {
    const viewport = imageWindow.current

    if (!viewport || !zoomed) return
    viewport.scrollLeft = (1600 - viewport.clientWidth) / 2
    viewport.scrollTop = (1200 - viewport.clientHeight) / 2
  }, [zoomed, screen])

  const scaleControls = (
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
  )

  function keepImage() {
    if (!hasImage || isSaved) return

    if (values.saveFailure) {
      setPlaying(false)
      update({ state: 'save-error' })

      return
    }

    update({ saved: saveList(frame), state: state === 'save-error' ? 'idle' : state })
    setNotice('Image saved with its original data and preview.')
  }

  function details(id: number) {
    return id <= 2 ? 'September 4, 2026' : 'September 5, 2026'
  }

  function time(id: number) {
    return `21:${String(10 + Math.floor(id / 6)).padStart(2, '0')}:${String((id % 6) * 10).padStart(2, '0')}`
  }

  function download(format: string) {
    setNotice(`Workshop example: ${format} download. No file is created in this preview.`)
  }

  const image = (id: number) => <CaptureRunExposure frame={id} conditions="clear" />

  const imageDetails = (id: number) => (
    <dl className="vela-saved-details">
      <div>
        <dt>Captured</dt>
        <dd>{details(id)} · {time(id)}</dd>
      </div>
      <div>
        <dt>Camera</dt>
        <dd>Simulator Color Camera</dd>
      </div>
      <div>
        <dt>Exposure</dt>
        <dd>{exposureFor(id)} s · Color</dd>
      </div>
      <div>
        <dt>Dimensions</dt>
        <dd>1600 × 1200</dd>
      </div>
      <div>
        <dt>Image quality</dt>
        <dd>146 stars · HFR 2.24 px</dd>
      </div>
    </dl>
  )

  return (
    <article className="vela-capture-demo vela-capture-run-demo vela-saved-demo">
      <header className="vela-capture-shell">
        <strong>Vela</strong>
        <span>Offline rig</span>
        <span>Observe</span>
      </header>
      <main className="vela-capture-main">
        {screen !== 'observe' && (
          <Button
            className="vela-capture-back"
            tone="quiet"
            size="small"
            onClick={() => update({ screen: screen === 'detail' ? 'saved' : 'observe' })}
          >
            {'← '}
            {screen === 'detail' ? 'Saved images' : 'Observe'}
          </Button>
        )}
        <header className="vela-capture-heading">
          <div>
            <p>Offline rig</p>
            <h1 ref={heading} tabIndex={-1}>{pageTitle()}</h1>
          </div>
          {renderPageAction()}
        </header>
        {screen === 'observe' && (
          <>
            <p className="vela-capture-intro">
              {busy
                ? 'Your capture is running. You can browse saved images while it continues.'
                : 'Your rig is connected. What would you like to do?'}
            </p>
            <div className="vela-capture-hub">
              <Panel className="vela-capture-entry">
                <div className="vela-capture-entry__preview">
                  {hasImage && image(frame)}
                  <span>{hasImage ? 'Latest exposure' : 'No exposure yet'}</span>
                </div>
                <div className="vela-capture-entry__body">
                  <h2>Capture</h2>
                  <p>Take exposures and inspect the latest image.</p>
                  <div className="vela-capture-entry__status">{busy ? 'Capturing' : 'Ready for an exposure'}</div>
                  <Button tone="accent" onClick={() => update({ screen: 'capture' })}>Open capture →</Button>
                </div>
              </Panel>
              <Panel className="vela-capture-entry">
                <div className="vela-capture-entry__body">
                  <h2>Saved images</h2>
                  <p>Your retained frames, ready to browse and take into your processing tools.</p>
                  <div className="vela-capture-entry__status">{saved.length} images · Original FITS + preview</div>
                  <Button onClick={() => update({ screen: 'saved' })}>Browse saved images →</Button>
                </div>
              </Panel>
            </div>
          </>
        )}
        {screen === 'capture' && (
          <>
            {state === 'save-error' && (
              <div className="vela-capture-warning" role="alert">
                <strong>Image could not be saved</strong>
                <p>Capture is stopped. This image is still available below. Check storage, then try keeping it again.</p>
              </div>
            )}
            <div className="vela-capture-layout">
              <section className="vela-capture-image" aria-label="Latest image">
                <header>
                  <div>
                    <h2>Latest image</h2>
                    <span>{hasImage ? `${time(frame)}${busy ? ' · Previous exposure' : ''}` : 'No exposure yet'}</span>
                  </div>
                  {hasImage && <div className="vela-saved-image-actions">{scaleControls}{isSaved ? <Badge tone="positive">Saved</Badge> : <Button size="small" onClick={keepImage}>Keep this image</Button>}</div>}
                </header>
                <div
                  className="vela-capture-image__window"
                  ref={imageWindow}
                  data-zoomed={hasImage && zoomed || undefined}
                  tabIndex={hasImage && zoomed ? 0 : undefined}
                  role={hasImage && zoomed ? 'region' : undefined}
                  aria-label={hasImage && zoomed ? 'Image at 100 percent. Scroll to inspect.' : undefined}
                >
                  {hasImage
                    ? image(frame)
                    : (
                      <div className="vela-capture-empty">
                        <h3>Your first image starts here</h3>
                        <p>Take an exposure to inspect it here.</p>
                      </div>
                    )}
                </div>
                {hasImage && (
                  <>
                    <div className="vela-capture-image-statistics">
                      <dl>
                        <div>
                          <dt>Dimensions</dt>
                          <dd>1600 × 1200</dd>
                        </div>
                        <div>
                          <dt>Stars</dt>
                          <dd>146</dd>
                        </div>
                        <div>
                          <dt>HFR · px</dt>
                          <dd>2.24</dd>
                        </div>
                      </dl>
                    </div>
                    <footer>
                      <span>{String(values.imageSeconds)} s · Color · Display stretched</span>
                      <span>{isSaved ? 'FITS + preview saved' : 'Not saved'}</span>
                    </footer>
                  </>
                )}
              </section>
              <Panel className="vela-capture-controls" title="Capture images">
                <div className="vela-capture-camera">
                  <div>
                    <strong>Simulator Color Camera</strong>
                    <span>Imaging camera</span>
                  </div>
                </div>
                <Input
                  label="Exposure · seconds"
                  type="number"
                  min="0.1"
                  max="600"
                  step="0.1"
                  disabled={busy}
                  value={String(values.exposure)}
                  invalid={!validExposure}
                  onChange={event => update({ exposure: event.target.value })}
                />
                <Checkbox
                  label="Repeat until stopped"
                  checked={Boolean(values.repeat)}
                  disabled={busy}
                  onChange={event => update({ repeat: event.target.checked })}
                />
                <Checkbox
                  label="Save frames"
                  description="Keep every completed image as FITS + preview."
                  checked={Boolean(values.saveFrames)}
                  disabled={busy}
                  onChange={event => update({ saveFrames: event.target.checked })}
                />
                <div className="vela-capture-command">
                  <Button
                    size="large"
                    tone={busy ? 'neutral' : 'accent'}
                    disabled={!busy && !validExposure}
                    onClick={() => {
                      setPlaying(!busy)
                      update({ state: busy ? 'idle' : 'capturing' })
                    }}
                  >
                    {busy ? 'Stop capture' : values.repeat ? 'Start run' : 'Take exposure'}
                  </Button>
                </div>
                <div className="vela-capture-progress">
                  <div>
                    <strong role="status">{busy ? 'Exposing' : state === 'save-error' ? 'Capture stopped' : 'Ready for an exposure'}</strong>
                  </div>
                  <p>
                    {values.saveFrames
                      ? 'Completed frames go to Saved images for this rig.'
                      : 'Frames are disposable. Use Keep this image to save one you want.'}
                  </p>
                </div>
              </Panel>
            </div>
          </>
        )}
        {screen === 'saved' && (
          <>
            <p className="vela-capture-intro">Original data and the preview you inspected, kept on your Vela server.</p>
            {saved.length === 0 ? (
              <Panel>
                <div className="vela-saved-empty">
                  <h2>No saved images yet</h2>
                  <p>Turn on Save frames before capturing, or keep an individual image when you see one worth saving.</p>
                  <Button onClick={() => update({ screen: 'capture' })}>Open capture →</Button>
                </div>
              </Panel>
            ) : ['September 5, 2026', 'September 4, 2026'].map(date => {
              const group = saved.filter(id => details(id) === date).sort((a, b) => b - a)

              return group.length > 0 && (
                <section className="vela-saved-group" key={date}>
                  <h2>
                    {date}
                    <span>{group.length} {group.length === 1 ? 'image' : 'images'}</span>
                  </h2>
                  <div className="vela-saved-grid">
                    {group.map(id => (
                      <button
                        className="vela-saved-card"
                        key={id}
                        onClick={() => update({ screen: 'detail', selected: id })}
                      >
                        <div className="vela-saved-thumbnail">{image(id)}</div>
                        <div className="vela-saved-card-copy">
                          <strong>{time(id)}</strong>
                          <span>{exposureFor(id)} s · Color</span>
                          <small>
                            {'FITS + preview '}
                            <span aria-hidden="true">→</span>
                          </small>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              )
            })}
          </>
        )}
        {screen === 'detail' && (
          <div className="vela-capture-layout">
            <section className="vela-capture-image" aria-label="Saved preview">
              <header>
                <div>
                  <h2>{time(selected)}</h2>
                  <span>{details(selected)}</span>
                </div>
                <div className="vela-saved-image-actions">
                  {scaleControls}
                  <Badge tone="positive">Saved</Badge>
                </div>
              </header>
              <div
                className="vela-capture-image__window"
                ref={imageWindow}
                data-zoomed={zoomed || undefined}
                tabIndex={zoomed ? 0 : undefined}
                role={zoomed ? 'region' : undefined}
                aria-label={zoomed ? 'Image at 100 percent. Scroll to inspect.' : undefined}
              >
                {image(selected)}
              </div>
              <footer>Display-stretched preview · Original data retained separately</footer>
            </section>
            <Panel title="Image details">
              {imageDetails(selected)}
              <div className="vela-saved-downloads">
                <Button tone="accent" onClick={() => download('Original FITS')}>Download FITS</Button>
                <Button onClick={() => download('Preview PNG')}>Download preview</Button>
              </div>
              <p className="vela-saved-help">Use the original FITS in Siril or your preferred processing tool.</p>
            </Panel>
          </div>
        )}
        <div className="vela-saved-notice" role="status">{notice}</div>
      </main>
      <footer className="vela-capture-prototype">Workshop only · Local image fixtures · 3 seconds per example exposure · No files saved or downloaded</footer>
    </article>
  )
}

export const specimen: ComponentSpecimen = {
  componentId: 'panel',
  componentName: 'Panel / Card',
  id: 'panel-saved-images',
  name: 'Saved images · Draft product example',
  description: 'Keep a displayed exposure or save every frame, then browse the same per-rig collection. Local fixtures only; no server storage or file downloads.',
  controls: {
    screen: { type: 'select', label: 'View', options: ['observe', 'capture', 'saved', 'detail'] },
    state: { type: 'select', label: 'Capture state', options: ['idle', 'capturing', 'save-error'] },
    hasImage: { type: 'boolean', label: 'Latest image available' },
    saveFrames: { type: 'boolean', label: 'Save frames' },
    repeat: { type: 'boolean', label: 'Repeat until stopped' },
    saveFailure: { type: 'boolean', label: 'Simulate storage failure' },
    saved: { type: 'text', label: 'Saved fixture IDs (empty for no images)' },
    exposure: { type: 'text', label: 'Exposure seconds' },
    imageSeconds: { type: 'text', label: 'Latest image exposure seconds' },
    exposures: { type: 'text', label: 'Captured exposure fixtures (ID:seconds)' },
    frame: { type: 'text', label: 'Latest fixture ID (5 or greater)' },
    selected: { type: 'text', label: 'Opened image ID' },
  },
  defaultProps: {
    screen: 'capture',
    state: 'idle',
    hasImage: true,
    saveFrames: false,
    repeat: true,
    saveFailure: false,
    saved: '4,3,2,1',
    exposure: '10',
    imageSeconds: '10',
    exposures: '',
    frame: 5,
    selected: 4
  },
  render: (props, onPropsChange) => <SavedImagesPreview props={props} {...(onPropsChange ? { onPropsChange } : {})} />,
}
