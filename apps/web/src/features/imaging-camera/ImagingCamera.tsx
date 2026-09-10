import { Button, Panel, Select } from '@vela/ui'
import { useEffect, useState } from 'react'
import { useImagingCamera } from './use-imaging-camera'
import './imaging-camera.css'

export function ImagingCamera({ rigId, interrupted, connecting }: { rigId: string, interrupted: boolean, connecting: boolean }) {
  const camera = useImagingCamera(rigId)
  const [editing, setEditing] = useState(false)
  const [choice, setChoice] = useState<{ id: string, name: string } | null>(null)
  useEffect(() => {
    if (camera.confirmedSaves) { setEditing(false); setChoice(null) }
  }, [camera.confirmedSaves])
  const { view, pending } = camera
  const selected = view?.selected
  const offline = interrupted || camera.offline
  const locked = offline || pending || connecting || camera.unconfirmed || !view?.editable
  const expanded = editing || !selected
  const selectedSlot = view?.cameras.find(item => item.id === selected?.id)
  const draft = choice ?? selected
  const validChoice = view?.cameras.find(item => item.id === draft?.id && item.name !== null && item.name === draft?.name)

  const notice = offline ? 'Rig updates are interrupted. The saved camera is remembered; reconnect to check or change it.'
    : view?.state === 'missing' ? 'The saved camera is not in the rig’s current device list. Choose a camera or check its connection to the server.'
    : view?.state === 'changed' ? `${selectedSlot?.configuredName ?? 'The saved camera slot'} now reports a different camera. Check the driver setup, then confirm which camera to use.`
    : view?.state === 'unavailable' ? 'Camera identity is unavailable. The saved selection is remembered; check the rig connection and camera setup.'
    : connecting || (view && !view.editable) ? 'Another rig operation is in progress. You can change the imaging camera when it finishes.' : null

  return <Panel className="vela-imaging-camera" aria-label="Imaging camera">
    <div className="vela-imaging-camera__summary">
      <div><h2>Imaging camera</h2><p>{selected?.name ?? (view ? 'Choose the camera Capture will use.' : 'Checking the saved camera…')}</p>
        {selected && <small>{selectedSlot ? `${selectedSlot.configuredName} · ` : ''}Saved for this rig</small>}</div>
      {!expanded && <Button tone="quiet" size="small" disabled={locked} onClick={() => { setChoice(null); setEditing(true) }}>Change</Button>}
    </div>
    {notice && <p className="vela-imaging-camera__notice" role="status">{notice}</p>}
    {camera.error && <p className="vela-imaging-camera__notice" role="status">{camera.error}</p>}
    {expanded && view && <form className="vela-imaging-camera__form" onSubmit={event => {
      event.preventDefault()

      if (!locked && validChoice?.name) void camera.save({ id: validChoice.id, name: validChoice.name })
    }}>
      <Select label="Camera" value={validChoice?.id ?? ''} disabled={locked} options={[
        { value: '', label: 'Choose a camera', disabled: true },
        ...view.cameras.map(item => ({ value: item.id, label: item.name ? `${item.name} · ${item.configuredName}` : `${item.configuredName} · Identity unavailable`, disabled: item.name === null })),
      ]} onChange={event => {
        const next = view.cameras.find(item => item.id === event.target.value)

        if (next?.name) setChoice({ id: next.id, name: next.name })
      }} />
      <p>Remembered for this rig. You can return here when your setup changes.</p>
      <div className="vela-imaging-camera__actions"><Button type="submit" tone="accent" disabled={locked || !validChoice} aria-busy={pending}>{pending ? 'Saving camera…' : 'Use this camera'}</Button>
        {selected && <Button type="button" tone="quiet" disabled={pending || camera.unconfirmed} onClick={() => { setChoice(null); setEditing(false) }}>Cancel</Button>}</div>
    </form>}
    {(camera.error || (!view && offline)) && <Button tone="quiet" disabled={pending} onClick={() => void camera.refresh()}>Check saved camera</Button>}
  </Panel>
}
