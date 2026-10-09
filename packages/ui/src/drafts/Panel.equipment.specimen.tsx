import { useEffect, useId, useState } from 'react'
import { Button, IconButton, Input, NavigationBar, Select } from '../components'
import type { ComponentSpecimen } from '../themes'
import { DeviceMark, devices } from './fieldroom-equipment/fixtures'
import './Panel.equipment.specimen.css'

type Props = Record<string, string | number | boolean>

function Equipment({ props, onPropsChange }: {
  props: Props
  onPropsChange?: (patch: Props) => void
}) {
  const [local, setLocal] = useState(props)

  const values = onPropsChange ? props : local

  const update = (patch: Props) => onPropsChange
    ? onPropsChange(patch)
    : setLocal(current => ({ ...current, ...patch }))

  const id = useId()
  const open = String(values.expanded).split(',')
  const [notice, setNotice] = useState('')
  const focalLength = Number(values.focalLength)
  const invalidFocal = !Number.isFinite(focalLength) || focalLength < 10 || focalLength > 20000
  const mountState = String(values.mountState ?? 'tracking-on')
  const mount = mountPresentation(mountState)

  return (
    <article className="vela-equipment-demo" aria-label="Equipment product example">
      <NavigationBar
        home={{ href: '#home', onClick: event => event.preventDefault() }}
        rigs={[{ id: 'askar', name: 'Askar FRA 400' }]}
        currentRigId="askar"
        onRigChange={() => {}}
        utility={<span>● Partly connected</span>}
        links={['Tonight', 'Explore the sky', 'Photographs'].map((label, index) => ({
          label, href: `#page-${index}`, onClick: event => event.preventDefault(),
        }))}
      />
      <header className="vela-equipment-demo__heading">
        <div><h1>Your rig</h1><span>Askar FRA 400</span></div>
        <a href="#tonight" onClick={event => { event.preventDefault(); setNotice('Workshop example: return to Tonight.') }}>← Back to Tonight</a>
      </header>
      <div className="vela-equipment-demo__layout">
        <section className="vela-equipment-demo__readiness" aria-label="Rig readiness">
          <div><h2>Imaging camera connected</h2><p>3 of 4 devices connected · Other camera disconnected</p></div>
          <Button tone="accent" onClick={() => setNotice('Workshop example: Connect devices. No hardware command is sent.')}>Connect devices</Button>
        </section>
        <section className="vela-equipment-demo__devices" aria-label="Equipment">
          <header>
            <h2>Equipment</h2>
            <button className="vela-equipment-demo__text-action" onClick={() => setNotice('Sample state checked just now. No device reads are sent.')}>Refresh state</button>
          </header>
          {devices.map(device => (
            <section key={device.id} className="vela-equipment-demo__device" aria-label={device.name}>
              <div className="vela-equipment-demo__row">
                <DeviceMark kind={device.kind} />
                <div className="vela-equipment-demo__name"><h3>{device.name}</h3><p>{device.id === 'mount' ? `Mount · ${mount.role}` : device.role}</p></div>
                <p className="vela-equipment-demo__summary">{device.id === 'mount' ? `Tracking ${mount.tracking.toLowerCase()}` : device.summary}</p>
                <p className="vela-equipment-demo__connection">{device.connected ? '● Connected' : '○ Disconnected'}</p>
                <IconButton
                  tone="quiet"
                  label={`${open.includes(device.id) ? 'Hide' : 'Show'} ${device.name} details`}
                  aria-expanded={open.includes(device.id)}
                  aria-controls={`${id}-${device.id}`}
                  icon={<span aria-hidden="true">{open.includes(device.id) ? '⌃' : '⌄'}</span>}
                  onClick={() => update({ expanded: open.includes(device.id)
                    ? open.filter(item => item !== device.id).join(',')
                    : [...open.filter(Boolean), device.id].join(',') })}
                />
              </div>
              <div id={`${id}-${device.id}`} hidden={!open.includes(device.id)} className="vela-equipment-demo__device-details">
                <dl>{device.details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{device.id === 'mount' && label === 'Tracking' ? mount.tracking : device.id === 'mount' && label === 'Parked' ? mount.parking : value}</dd></div>)}</dl>
                {device.id === 'mount' && (
                  <MountControlsPreview
                    state={mountState}
                    result={String(values.mountResult ?? 'confirmed')}
                    onChange={state => update({ mountState: state })}
                  />
                )}
              </div>
            </section>
          ))}
        </section>
        <section className="vela-equipment-demo__setup" aria-label="Imaging setup">
          <h2>Imaging setup</h2>
          <div className="vela-equipment-demo__setup-group">
            <Select
              label="Imaging camera"
              value={String(values.camera)}
              options={devices.filter(device => device.kind === 'Camera').map(device => ({ value: device.id, label: device.name }))}
              onChange={event => update({ camera: event.target.value })}
            />
            <p>Used for capture, framing, autofocus, and polar alignment.</p>
          </div>
          <div className="vela-equipment-demo__setup-group vela-equipment-demo__divider">
            <div className="vela-equipment-demo__focal">
              <Input
                label="Effective focal length"
                value={String(values.focalLength)}
                inputMode="decimal"
                invalid={Boolean(values.validate) && invalidFocal}
                message={values.validate && invalidFocal ? 'Enter a focal length from 10 to 20000 mm.' : ''}
                onChange={event => update({ focalLength: event.target.value })}
              />
              <span aria-hidden="true">mm</span>
            </div>
            <p>Include any reducer or Barlow lens. Vela uses this to predict the camera’s field of view.</p>
          </div>
          <Button tone="accent" onClick={() => {
            update({ validate: true })

            if (!invalidFocal) setNotice('Workshop example: imaging setup saved locally. No configuration request is sent.')
          }}>Save imaging setup</Button>
          <div className="vela-equipment-demo__setup-group vela-equipment-demo__divider">
            <p>Device connections and activity are read from the rig. Imaging setup is saved in Vela.</p>
            <a href="#saved-rigs" onClick={event => { event.preventDefault(); setNotice('Workshop example: open the saved-rig catalog.') }}>Manage saved rigs</a>
          </div>
        </section>
        <section className="vela-equipment-demo__preparation" aria-label="Rig preparation">
          <p>Prepare the rig</p>
          <div>
            <Button onClick={() => setNotice('Workshop example: open polar alignment.')}>Polar alignment →</Button>
            <Button onClick={() => setNotice('Workshop example: open autofocus.')}>Autofocus →</Button>
          </div>
        </section>
      </div>
      {notice && <p role="status" className="vela-equipment-demo__notice">{notice}</p>}
      <footer>
        <span>State checked just now · Disconnected devices have no live measurements</span>
        <details className="vela-equipment-demo__rig-details">
          <summary>Rig details</summary>
          <a href="#preparation" onClick={event => { event.preventDefault(); setNotice('Workshop example: open capture preparation.') }}>Capture preparation →</a>
          <dl><div><dt>Endpoint</dt><dd>192.168.4.104:11111</dd></div><div><dt>Added to Vela</dt><dd>Sample date</dd></div><div><dt>Last inventory</dt><dd>Sample timestamp</dd></div></dl>
          <div><p>Design study · Sample device states · No hardware</p><Button tone="quiet" onClick={() => setNotice('Workshop example: open Forget confirmation.')}>Forget rig</Button></div>
        </details>
      </footer>
    </article>
  )
}

function mountPresentation(state: string) {
  if (state === 'unknown') return { tracking: 'Unknown', parking: 'Unknown', role: 'Status unknown' }

  if (state === 'parked') return { tracking: 'Off', parking: 'Yes', role: 'Parked' }

  return { tracking: state === 'tracking-on' ? 'On' : 'Off', parking: 'No', role: 'Not parked' }
}

const confirmedMount = {
  unpark: 'Mount confirmed unparked.',
  'tracking-on': 'Tracking confirmed on.',
  'tracking-off': 'Tracking confirmed off.',
}

function MountControlsPreview({ state, result, onChange }: {
  state: string
  result: string
  onChange(state: string): void
}) {
  const [action, setAction] = useState<keyof typeof confirmedMount | null>(null)
  const [message, setMessage] = useState('')
  const [uncertain, setUncertain] = useState(false)
  const messageId = useId()
  const pending = action !== null

  useEffect(() => {
    if (!action) return

    const timer = setTimeout(() => {
      setAction(null)

      if (result === 'uncertain') {
        setUncertain(true)
        setMessage('The mount command could not be confirmed. Check mount state before another command.')
      } else if (result === 'failed') {
        setMessage('The mount rejected the command. Its last confirmed state is shown above.')
      } else {
        onChange(action === 'unpark' ? 'tracking-off' : action)
        setMessage(confirmedMount[action])
      }
    }, 1200)

    return () => clearTimeout(timer)
  }, [action, result, onChange])

  let unavailable = ''

  if (state === 'unknown') unavailable = 'Current parked and tracking state is unavailable. Check mount state before sending a command.'
  else if (state === 'parked') unavailable = 'Unpark the mount before turning tracking on.'

  return (
    <div className="vela-equipment-demo__mount-controls" aria-label="Mount controls">
      <div className="vela-equipment-demo__mount-actions">
        {(state === 'parked' || state === 'unknown') && (
          <Button disabled={pending || uncertain || state === 'unknown'} aria-busy={action === 'unpark'} aria-describedby={messageId} onClick={() => setAction('unpark')}>
            {action === 'unpark' ? 'Unparking…' : 'Unpark mount'}
          </Button>
        )}
        <Button disabled={pending || uncertain || state === 'unknown' || state === 'parked'} aria-busy={pending && action !== 'unpark'} aria-describedby={messageId} onClick={() => setAction(state === 'tracking-on' ? 'tracking-off' : 'tracking-on')}>
          {action === 'tracking-on' ? 'Turning tracking on…' : action === 'tracking-off' ? 'Turning tracking off…' : state === 'tracking-on' ? 'Turn tracking off' : 'Turn tracking on'}
        </Button>
        {(uncertain || state === 'unknown') && <Button disabled={pending} onClick={() => { setUncertain(false); onChange('tracking-off'); setMessage('Mount state checked: unparked, tracking off.') }}>Check mount state</Button>}
      </div>
      <p id={messageId} role="status">{pending ? 'Waiting for the mount to confirm the change…' : message || unavailable || 'Tracking follows the sky. It does not slew to your selected subject.'}</p>
    </div>
  )
}

export const specimen: ComponentSpecimen = {
  componentId: 'panel', componentName: 'Panel / Card', id: 'fieldroom-equipment',
  name: 'Equipment · Fieldroom product example',
  description: 'Source 03.5, preserved device facts and compact readiness → devices → setup → preparation. Sample state only; no device commands or configuration writes.',
  controls: {
    expanded: { type: 'text', label: 'Expanded device IDs (comma separated)' },
    camera: { type: 'select', label: 'Imaging camera', options: ['main-camera', 'other-camera'] },
    focalLength: { type: 'text', label: 'Effective focal length · mm' },
    validate: { type: 'boolean', label: 'Validate focal length' },
    mountState: { type: 'select', label: 'Mount state', options: ['tracking-off', 'tracking-on', 'parked', 'unknown'] },
    mountResult: { type: 'select', label: 'Mount command result', options: ['confirmed', 'failed', 'uncertain'] },
  },
  defaultProps: { expanded: '', camera: 'main-camera', focalLength: '400', validate: false, mountState: 'tracking-on', mountResult: 'confirmed' },
  render: (props, onPropsChange) => <Equipment props={props} {...(onPropsChange ? { onPropsChange } : {})} />,
}
