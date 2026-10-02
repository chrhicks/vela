import { useEffect, useId, useState } from 'react'
import { Button, Checkbox, Dialog, Input, NavigationBar, Select, Switch } from '@vela/ui'
import './capture-preparation.css'

export interface CapturePreparationState {
  connection: 'ready' | 'disconnected' | 'unconfirmed'
  exposureSeconds: number
  repeat: boolean
  saveFrames: boolean
}

type Connection = CapturePreparationState['connection'] | 'connecting' | 'checking'

const image = new URL('../../../../../packages/ui/src/drafts/target-framing/crescent.jpg', import.meta.url).href

export function CapturePreparation({ initialState }: { initialState: CapturePreparationState }) {
  const [checkedOutcome, setCheckedOutcome] = useState(false)
  const [connection, setConnection] = useState<Connection>(initialState.connection)
  const [exposure, setExposure] = useState(String(initialState.exposureSeconds))
  const [repeat, setRepeat] = useState(initialState.repeat)
  const [saveFrames, setSaveFrames] = useState(initialState.saveFrames)
  const [cooler, setCooler] = useState(true)
  const [setpoint, setSetpoint] = useState('-10')
  const [appliedSetpoint, setAppliedSetpoint] = useState(-10)
  const [notice, setNotice] = useState<{ title: string; description: string } | null>(null)
  const [inspect, setInspect] = useState(false)
  const [native, setNative] = useState(false)
  const readinessId = useId()
  const ready = connection === 'ready'
  const pending = connection === 'connecting' || connection === 'checking'
  const seconds = Number(exposure)
  const validSeconds = exposure.trim() !== '' && Number.isFinite(seconds) && seconds >= 0.1 && seconds <= 600
  const temperature = Number(setpoint)
  const validTemperature = setpoint.trim() !== '' && Number.isFinite(temperature) && temperature >= -80 && temperature <= 50

  useEffect(() => {
    if (!pending) return

    const timer = window.setTimeout(() => {
      if (connection === 'checking') setCheckedOutcome(true)
      setConnection('ready')
    }, 1200)

    return () => window.clearTimeout(timer)
  }, [connection, pending])

  function showDestination(title: string) {
    setNotice({
      title,
      description: 'This destination is outside the Capture preparation prototype. Close this preview to keep preparing your capture. No devices have been commanded.',
    })
  }

  const imageView = (
    <div className="prep-preview__image" data-native={native || undefined}>
      <img src={image} alt="Reference photograph of the Crescent Nebula used as an illustrative framing exposure" />
    </div>
  )

  return (
    <div className="prep-preview">
      <NavigationBar
        home={{
          href: '#rigs',
          onClick: event => {
            event.preventDefault()
            showDestination('All rigs')
          },
        }}
        rigs={[{ id: 'askar', name: 'Askar FRA 400' }]}
        currentRigId="askar"
        onRigChange={() => {}}
        utility={(
          <span className="prep-preview__connection">
            {ready ? '● Connected' : '○ Connection unavailable'}
          </span>
        )}
        links={['Tonight', 'Explore the sky', 'Photographs'].map(label => ({
          href: `#${label.toLowerCase().replaceAll(' ', '-')}`,
          label,
          current: label === 'Tonight',
          onClick: event => {
            event.preventDefault()
            showDestination(label)
          },
        }))}
      />
      <div className="prep-preview__body">
        <div className="prep-preview__columns">
          <section className="prep-preview__exposure" aria-label="Last test exposure">
            <header>
              <h2>Last test exposure</h2>
              <div className="prep-preview__image-controls" role="group" aria-label="Image scale">
                <Button aria-pressed={!native} onClick={() => setNative(false)}>Fit</Button>
                <Button aria-pressed={native} onClick={() => setNative(true)}>100%</Button>
                <Button aria-label="Enlarge test exposure" onClick={() => setInspect(true)}>↗</Button>
              </div>
            </header>
            {imageView}
            <div className="prep-preview__image-meta">
              <span>Reference image · mock exposure</span>
              <div>
                <span>10 s · Framing check</span>
                <span>Star size 2.1 px HFR</span>
                <span>842 stars</span>
                <span>Temporary</span>
              </div>
            </div>
          </section>
          <div className="prep-preview__settings">
            <header className="prep-preview__subject">
              <div>
                <span>Your subject</span>
                <Button tone="quiet" onClick={() => showDestination('Change target')}>
                  Change target
                </Button>
              </div>
              <h1 className="vela-type-subject">The Crescent Nebula</h1>
              <p>NGC 6888 · Cygnus · Emission nebula</p>
            </header>
            <section className="prep-preview__preparation" aria-label="Preparation tools">
              <header>
                <h2>Preparation</h2>
                <span>Askar FRA 400</span>
              </header>
              <div className="prep-preview__tools">
                <Button onClick={() => showDestination('Polar alignment')}>Polar alignment →</Button>
                <Button onClick={() => showDestination('Autofocus')}>Autofocus →</Button>
              </div>
              <p>Use these when needed before capturing.</p>
            </section>
            <form
              className="prep-preview__capture"
              aria-label="Capture settings"
              onSubmit={event => {
                event.preventDefault()

                if (!ready || !validSeconds) return
                setNotice({
                  title: 'Capture preview',
                  description: `${seconds} second exposures${repeat ? ', repeated until you stop' : ', one exposure'}${saveFrames ? ', saving every exposure' : ', without saving every exposure'}. In Vela, this opens the active capture. This workshop preview does not start a camera.`,
                })
              }}
            >
              <header>
                <h2>Capture settings</h2>
                <span>{ready ? 'Camera idle' : 'Camera unavailable'}</span>
              </header>
              <Select
                className="prep-preview__camera"
                label="Imaging camera"
                aria-label="Imaging camera"
                value="asi2600"
                disabled={!ready}
                options={[{ value: 'asi2600', label: 'ASI2600MC Pro' }]}
              />
              <div className="prep-preview__unit-field">
                <Input
                  className="prep-preview__seconds"
                  label="Exposure time"
                  type="number"
                  min="0.1"
                  max="600"
                  step="0.1"
                  value={exposure}
                  invalid={!validSeconds}
                  onChange={event => setExposure(event.target.value)}
                />
                <span>seconds</span>
              </div>
              {!validSeconds && <p role="status">Choose an exposure from 0.1 to 600 seconds.</p>}
              <div className="prep-preview__options">
                <Checkbox
                  label="Repeat until I stop"
                  checked={repeat}
                  onChange={event => setRepeat(event.target.checked)}
                />
                <Checkbox
                  label="Save every exposure"
                  checked={saveFrames}
                  onChange={event => setSaveFrames(event.target.checked)}
                />
              </div>
              {!ready && (
                <div className="prep-preview__readiness" id={readinessId} role="status">
                  <strong>
                    {pending
                      ? connection === 'checking' ? 'Checking device state…' : 'Connecting devices…'
                      : connection === 'unconfirmed' ? 'Connection outcome unknown' : 'Connect devices to capture'}
                  </strong>
                  <p>
                    {pending
                      ? 'Waiting for fresh camera, mount, and focuser readings.'
                      : connection === 'unconfirmed'
                        ? 'The connection request was sent, but its result could not be confirmed. Check device state before sending another command.'
                        : 'The camera, mount, and focuser are disconnected. Your capture settings are kept here.'}
                  </p>
                  <Button
                    type="button"
                    pending={pending}
                    onClick={() => setConnection(connection === 'unconfirmed' ? 'checking' : 'connecting')}
                  >
                    {connection === 'unconfirmed' || connection === 'checking' ? 'Check state' : 'Connect devices'}
                  </Button>
                </div>
              )}
              {checkedOutcome && (
                <p role="status">
                  Devices are now confirmed connected. The earlier command response remains unconfirmed;
                  no connection command was replayed.
                </p>
              )}
              <Button
                type="submit"
                tone="accent"
                disabled={!ready || !validSeconds}
                aria-describedby={!ready ? readinessId : undefined}
              >
                Start capture
              </Button>
            </form>
            <section className="prep-preview__cooling" aria-label="Camera cooling">
              <header>
                <h2>Camera cooling</h2>
                <div>
                  <span>{ready ? cooler ? 'On' : 'Off' : 'Unknown'}</span>
                  <Switch label="Cooler on" checked={cooler} disabled={!ready} onChange={setCooler} />
                </div>
              </header>
              <div className="prep-preview__temperature">
                <strong className="vela-type-metric">{ready ? '−8.6°C' : '—'}</strong>
                <span>
                  {ready
                    ? `${cooler && appliedSetpoint < -8.6 ? 'Cooling toward' : 'Requested'} ${appliedSetpoint}°C${cooler ? ' · 62% power' : ''}`
                    : 'Waiting for a fresh camera reading'}
                </span>
              </div>
              <form onSubmit={event => {
                event.preventDefault()

                if (ready && validTemperature) setAppliedSetpoint(temperature)
              }}>
                <Input
                  label="Setpoint · °C"
                  aria-label="Target temperature · °C"
                  type="number"
                  min="-80"
                  max="50"
                  step="0.1"
                  value={setpoint}
                  disabled={!ready}
                  invalid={!validTemperature}
                  onChange={event => setSetpoint(event.target.value)}
                />
                <Button type="submit" disabled={!ready || !validTemperature}>Apply</Button>
              </form>
              {!validTemperature && <p role="status">Choose −80 to 50 °C.</p>}
              <p>Capture can start while cooling.</p>
            </section>
          </div>
        </div>
        <footer className="prep-preview__equipment">
          <div>
            <strong>Askar FRA 400</strong>
            <span>{ready ? `Camera −8.6°C · Cooler ${cooler ? 'on' : 'off'}` : 'Camera · State unavailable'}</span>
            <span>{ready ? 'Focuser 32,842 · Idle' : 'Focuser · State unavailable'}</span>
          </div>
          <Button tone="quiet" onClick={() => showDestination('Equipment & settings')}>
            Equipment & settings →
          </Button>
        </footer>
      </div>
      <Dialog
        open={notice !== null}
        title={notice?.title ?? ''}
        description={notice?.description}
        onDismiss={() => setNotice(null)}
      />
      <Dialog
        open={inspect}
        title="Inspect test exposure"
        description="Illustrative workshop image. Fit and 100% use the same bundled pixels."
        onDismiss={() => setInspect(false)}
      >
        {imageView}
      </Dialog>
    </div>
  )
}
