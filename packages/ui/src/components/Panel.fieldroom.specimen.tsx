import { useId, useState } from 'react'
import type { ComponentSpecimen } from '../themes'
import { Button } from './Button'
import { Checkbox } from './Checkbox'
import { Dialog } from './Dialog'
import { IconButton } from './IconButton'
import { Input } from './Input'
import { Panel } from './Panel'
import { Select } from './Select'
import { Tabs } from './Tabs'
import './Panel.fieldroom.specimen.css'

function FieldroomFoundations() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [requests, setRequests] = useState(0)
  const cancelId = useId()

  return (
    <div className="vela-fieldroom-specimen">
      <header>
        <p className="vela-type-caption">Fieldroom / Shared foundations</p>
        <h1 className="vela-type-page">Clear intent, steady targets</h1>
        <p className="vela-type-body">Source-backed recipes from DS.02, DS.05–09 and DS.15. Commands here are local examples.</p>
      </header>

      <section className="vela-fieldroom-specimen__type" aria-label="Typography roles">
        <div><span className="vela-type-caption">Metric</span><p className="vela-type-metric">42.8</p></div>
        <div><span className="vela-type-caption">Subject</span><p className="vela-type-subject">Andromeda</p></div>
        <div><span className="vela-type-caption">Section</span><p className="vela-type-section">Through the night</p></div>
        <div><span className="vela-type-caption">Body</span><p className="vela-type-body">The latest exposure is ready to inspect.</p></div>
      </section>

      <section className="vela-fieldroom-specimen__grid" aria-label="Measured controls">
        <Panel title="Actions">
          <div className="vela-fieldroom-specimen__actions">
            <Button tone="accent" pending={pending} onClick={() => {
              setPending(true)
              setRequests(count => count + 1)
            }}>{pending ? 'Starting…' : 'Start capture'}</Button>
            <IconButton label="Refresh example" onClick={() => setPending(false)} icon={<svg aria-hidden="true" viewBox="0 0 20 20" fill="none"><path d="M3 8a7 7 0 1 1 1 7M3 3v5h5" /></svg>} />
          </div>
          <p className="vela-type-supporting">46px text controls; 44px icon target. Refresh resets the local pending example. {requests} local requests.</p>
          <Button disabled>Start capture</Button>
          <p className="vela-type-supporting">Unavailable until the camera is connected.</p>
        </Panel>
        <Panel title="Fields">
          <Input label="Exposure" defaultValue="30" message="0.1–600 seconds" />
          <Input label="Host or IP address" defaultValue="http://192.168.4.104" invalid message="Enter only the hostname or IP address." />
          <Select label="Imaging camera" defaultValue="camera" options={[{ value: 'camera', label: 'ASI2600MC Pro' }, { value: 'guide', label: 'Guide camera' }]} />
        </Panel>
        <Panel title="Choices">
          <Checkbox label="Save every frame" defaultChecked />
          <Checkbox label="Save every frame" disabled description="Choose a connected imaging camera first." />
          <Tabs items={[{ id: 'overview', label: 'Overview', content: <p className="vela-type-supporting">Targets follow their content width.</p> }, { id: 'details', label: 'Details', content: <p className="vela-type-supporting">24px between targets; 2px active line.</p> }]} />
        </Panel>
      </section>

      <section className="vela-fieldroom-specimen__grid" aria-label="Surfaces and state">
        <article className="vela-fieldroom-specimen__capture">
          <div className="vela-fieldroom-specimen__capture-row">
            <span className="vela-type-control">● Capturing</span>
            <span className="vela-type-supporting">Exposure 13</span>
          </div>
          <div className="vela-fieldroom-specimen__reading">
            <span className="vela-type-metric">01:24</span>
            <span className="vela-type-supporting">left in this exposure</span>
          </div>
          <progress aria-label="Example exposure progress" value={0.54} max={1} />
          <div className="vela-fieldroom-specimen__capture-row">
            <p className="vela-type-supporting">12 saved · 36 min collected<br />Repeats until you stop</p>
            <Button tone="accent" leadingIcon={<i aria-hidden="true" className="vela-fieldroom-specimen__stop-mark" />}>Stop capture</Button>
          </div>
        </article>
        <article className="vela-fieldroom-specimen__notice" data-tone="warning">
          <span className="vela-type-caption">Interrupted</span>
          <h2 className="vela-type-section">Measurements paused</h2>
          <p className="vela-type-body">Last measured 45s ago. Baseline retained; waiting for a fresh measurement.</p>
          <Button>Stop session</Button>
        </article>
        <article className="vela-fieldroom-specimen__notice" data-tone="danger">
          <span className="vela-type-caption">Error</span>
          <h2 className="vela-type-section">Image not saved</h2>
          <p className="vela-type-body">The run stopped after saving failed. The latest frame is still available to keep.</p>
          <Button>Retry saving image</Button>
        </article>
      </section>
      <Button onClick={() => setDialogOpen(true)}>Open forget confirmation</Button>
      <Dialog
        open={dialogOpen}
        title="Forget Askar FRA 400?"
        description="Remove this rig’s saved configuration from Vela. This does not change its ALPACA server or hardware. You can discover and add it again later."
        initialFocusId={cancelId}
        showCloseButton={false}
        onDismiss={() => setDialogOpen(false)}
        footer={<><Button id={cancelId} onClick={() => setDialogOpen(false)}>Cancel</Button><Button tone="accent" onClick={() => setDialogOpen(false)}>Forget rig</Button></>}
      />
    </div>
  )
}

export const specimen: ComponentSpecimen = {
  componentId: 'panel',
  componentName: 'Panel / Card',
  id: 'fieldroom-foundations',
  name: 'Fieldroom foundations · Reference',
  description: 'Measured shared controls, typography, surfaces and honest states from the frozen Fieldroom system.',
  controls: {},
  defaultProps: {},
  render: () => <FieldroomFoundations />,
}
