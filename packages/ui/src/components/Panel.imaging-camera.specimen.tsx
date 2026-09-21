import { useState } from 'react'
import type { ComponentSpecimen } from '../themes'
import { Badge } from './Badge'
import { Button } from './Button'
import { Panel } from './Panel'
import { Select } from './Select'
import './Panel.imaging-camera.specimen.css'

type Props = Record<string, string | number | boolean>

const cameras = [
  { value: 'main', label: 'ZWO ASI2600MC Pro · ASI Camera (1)' },
  { value: 'guide', label: 'ZWO ASI220MM Mini · ASI Camera (2)' },
]

function ImagingCameraPreview({ props, onPropsChange }: { props: Props, onPropsChange?: (patch: Props) => void }) {
  function cameraNotice() {
    switch (state) {
      case 'offline':
        return 'Rig updates are interrupted. The saved camera is remembered; reconnect to check or change it.'
      case 'missing':
        return 'The saved camera is not in the rig’s current device list. Choose a camera or check its connection to the server.'
      case 'changed':
        return `${slot} now reports a different camera. Check the driver setup, then confirm which camera to use.`
      case 'busy':
        return 'An exposure is in progress. You can change the imaging camera when it finishes.'
      default:
        return ''
    }
  }

  const [local, setLocal] = useState(props)
  const values = onPropsChange ? props : local
  const update = (patch: Props) => onPropsChange ? onPropsChange(patch) : setLocal(current => ({ ...current, ...patch }))
  const saved = String(values.camera)
  const state = String(values.state)
  const editing = Boolean(values.editing) || saved === 'none'
  const [choice, setChoice] = useState('')
  const unavailable = state === 'offline' || state === 'missing' || state === 'changed'
  const locked = state === 'busy' || state === 'offline'
  const name = saved === 'guide' ? 'ZWO ASI220MM Mini' : 'ZWO ASI2600MC Pro'
  const slot = saved === 'guide' ? 'ASI Camera (2)' : 'ASI Camera (1)'
  const selected = choice || (saved === 'none' ? '' : saved)
  const choices = state === 'missing' ? cameras.filter(camera => camera.value !== saved) : cameras

  const notice = cameraNotice()

  return (
    <article className="vela-imaging-demo">
      <header className="vela-imaging-shell">
        <strong>Vela</strong>
        <span>Askar FRA 400</span>
      </header>
      <main>
        <header className="vela-imaging-heading">
          <div>
            <p>Askar FRA 400</p>
            <h1>Observe</h1>
          </div>
          <Badge tone={state === 'offline' ? 'warning' : 'positive'}>{state === 'offline' ? 'Updates interrupted' : 'Connected'}</Badge>
        </header>
        <p className="vela-imaging-intro">
          {state === 'offline'
            ? 'Showing the saved setup while rig updates are interrupted.'
            : 'Your rig, ready for the next adjustment.'}
        </p>
        <Panel className="vela-imaging-setup">
          <div className="vela-imaging-summary">
            <div>
              <h2>Imaging camera</h2>
              <p>{saved === 'none' ? 'Choose the camera Capture will use.' : name}</p>
              {saved !== 'none' && <small>{slot} · Saved for this rig</small>}
            </div>
            {!editing && (
              <Button
                tone="quiet"
                size="small"
                disabled={locked}
                onClick={() => {
                  setChoice(saved)
                  update({ editing: true })
                }}
              >
                Change
              </Button>
            )}
          </div>
          {notice && <p className="vela-imaging-notice" role="status">{notice}</p>}
          {editing && (
            <form
              className="vela-imaging-form"
              onSubmit={event => {
                event.preventDefault()

                if (choices.some(camera => camera.value === selected) && !locked) {
                  update({ camera: selected, editing: false, state: 'ready' })
                  setChoice('')
                }
              }}
            >
              <Select
                label="Camera"
                value={choices.some(camera => camera.value === selected) ? selected : ''}
                disabled={locked}
                options={[{ value: '', label: 'Choose a camera', disabled: true }, ...choices]}
                onChange={event => setChoice(event.target.value)}
              />
              <p>Remembered for this rig. You can return here when your setup changes.</p>
              <div>
                <Button tone="accent" type="submit" disabled={!choices.some(camera => camera.value === selected) || locked}>Use this camera</Button>
                {saved !== 'none' && (
                  <Button
                    tone="quiet"
                    type="button"
                    onClick={() => {
                      setChoice('')
                      update({ editing: false })
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </form>
          )}
        </Panel>
        <div className="vela-imaging-activities">
          <Panel title="Capture">
            <p>Take an exposure and inspect what the camera sees.</p>
            <span>
              {saved === 'none'
                ? 'Choose an imaging camera above to begin.'
                : unavailable
                  ? 'Camera needs attention before capture.'
                  : state === 'busy' ? 'Exposing · 12 / 30 s' : `${name} · Ready`}
            </span>
            <Button
              tone="accent"
              disabled={saved === 'none' || unavailable || editing}
              onClick={() => update({ state: state === 'busy' ? 'ready' : 'busy' })}
            >
              {state === 'busy' ? 'Finish sample exposure' : 'Try capture state'}
              {' '}
              →
            </Button>
          </Panel>
          <Panel title="Polar alignment">
            <p>Measure your alignment and adjust the mount when you need to.</p>
            <span>Available independently of imaging-camera setup.</span>
          </Panel>
        </div>
      </main>
      <footer>Workshop interaction · Camera choice is a local fixture · No rig commands</footer>
    </article>
  )
}

export const specimen: ComponentSpecimen = {
  componentId: 'panel',
  componentName: 'Panel / Card',
  id: 'panel-imaging-camera',
  name: 'Imaging-camera setup · Product example',
  description: 'Choose a camera once from Observe, then keep its identity visible as a compact saved setting. Includes missing, changed, offline and busy states. Local fixtures only.',
  controls: {
    camera: { type: 'select', label: 'Saved camera', options: ['none', 'main', 'guide'] },
    state: { type: 'select', label: 'Rig state', options: ['ready', 'busy', 'offline', 'missing', 'changed'] },
    editing: { type: 'boolean', label: 'Editing camera' },
  },
  defaultProps: { camera: 'none', state: 'ready', editing: false },
  render: (props, onPropsChange) => <ImagingCameraPreview props={props} {...(onPropsChange ? { onPropsChange } : {})} />,
}
