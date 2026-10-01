import { Button, Input, Select } from '@vela/ui'
import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { isValidFocalLength } from '../targets/focal-length-api'
import { useFocalLengthSettings } from '../targets/use-focal-length-settings'
import type { useImagingCamera } from './use-imaging-camera'

export function ImagingSetup({ rigId, camera, interrupted, connecting, onSaved, onPendingChange }: {
  rigId: string
  camera: ReturnType<typeof useImagingCamera>
  interrupted: boolean
  connecting: boolean
  onSaved: () => void
  onPendingChange: (pending: boolean) => void
}) {
  const focal = useFocalLengthSettings(rigId)
  const [choice, setChoice] = useState<{ id: string; name: string } | null>(null)
  const [length, setLength] = useState<string | null>(null)
  const [validate, setValidate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [outcome, setOutcome] = useState('')
  const writing = useRef(false)
  const selected = camera.view?.selected
  const draft = choice ?? selected
  const validChoice = camera.view?.cameras.find(item => item.id === draft?.id && item.name === draft?.name && item.name !== null)
  const focalText = length ?? (focal.view?.focalLengthMm === null || !focal.view ? '' : String(focal.view.focalLengthMm))
  const focalNumber = Number(focalText)
  const validLength = focalText.trim() !== '' && isValidFocalLength(focalNumber)
  const cameraChanged = !!draft && (draft.id !== selected?.id || draft.name !== selected?.name)
  const focalChanged = focalNumber !== focal.view?.focalLengthMm
  const unavailable = interrupted || camera.offline || focal.offline || !camera.view?.editable || !focal.view || focal.view.active || connecting
  const uncertain = camera.unconfirmed || focal.unconfirmed
  const locked = saving || checking || unavailable || uncertain

  async function save() {
    setValidate(true)

    if (writing.current || locked || !validChoice?.name || !validLength) return
    writing.current = true
    setSaving(true)
    onPendingChange(true)
    setOutcome('')
    let savedCamera = false

    try {
      if (cameraChanged) {
        const result = await camera.save({ id: validChoice.id, name: validChoice.name })

        if (result.status !== 'confirmed') {
          setOutcome('Camera save was not confirmed. Focal length was not changed.')

          return
        }

        savedCamera = true
        onSaved()
      }

      if (focalChanged) {
        const result = await focal.save(focalNumber)

        if (result.status !== 'confirmed') {
          setOutcome(savedCamera
            ? 'Imaging camera saved. Focal length save was not confirmed.'
            : 'Focal length save was not confirmed.')

          return
        }
      }

      setOutcome(cameraChanged || focalChanged ? 'Imaging setup saved.' : 'Imaging setup is already saved.')
      onSaved()
    } finally {
      writing.current = false
      setSaving(false)
      onPendingChange(false)
    }
  }

  async function check() {
    if (writing.current || checking) return
    setChecking(true)

    try {
      const [cameraView, focalView] = await Promise.all([camera.refresh(), focal.refresh()])
      setOutcome(cameraView && focalView
        ? 'Saved setup checked. Review the values and any remaining warnings before saving.'
        : 'Saved setup could not be fully checked. Review the remaining warnings before saving.')
    } finally {
      setChecking(false)
    }
  }

  let notice: string | null = null

  if (interrupted || camera.offline || focal.offline)
    notice = 'Setup updates are interrupted. Showing the last saved values; your edits are preserved.'
  else if (camera.view?.state === 'changed')
    notice = 'The saved camera slot now reports a different camera. Confirm which camera to use.'
  else if (camera.view?.state === 'missing')
    notice = 'The saved camera is missing from the current inventory. Choose a camera or check the rig.'
  else if (camera.view?.state === 'unavailable')
    notice = 'Camera identity is unavailable. Check the rig connection and camera setup.'
  else if (connecting || focal.view?.active || (camera.view && !camera.view.editable))
    notice = 'Another rig operation is in progress. Imaging setup can be saved when it finishes.'

  return (
    <form noValidate className="equipment__setup" aria-label="Imaging setup" onSubmit={event => {
      event.preventDefault()
      void save()
    }}>
      <h2>Imaging setup</h2>
      <div className="equipment__setup-group">
        <Select
          label="Imaging camera"
          value={validChoice?.id ?? ''}
          disabled={saving || checking || connecting || !camera.view}
          invalid={validate && !validChoice}
          message={validate && !validChoice ? 'Choose a currently identified camera.' : undefined}
          options={[
            { value: '', label: draft?.name ? `${draft.name} · Check identity` : 'Choose a camera', disabled: true },
            ...(camera.view?.cameras ?? []).map(item => ({ value: item.id, label: item.name ?? `${item.configuredName} · Identity unavailable`, disabled: item.name === null })),
          ]}
          onChange={event => {
            const item = camera.view?.cameras.find(camera => camera.id === event.target.value)

            if (item?.name) setChoice({ id: item.id, name: item.name })
            setOutcome('')
          }}
        />
        <p>Used for capture, framing, autofocus, and polar alignment.</p>
      </div>
      <div className="equipment__setup-group equipment__divider">
        <div className="equipment__focal">
          <Input
            label="Effective focal length"
            type="number"
            min={10}
            max={20000}
            step="any"
            value={focalText}
            inputMode="decimal"
            disabled={saving || checking}
            invalid={validate && !validLength}
            message={validate && !validLength ? 'Enter a focal length from 10 to 20000 mm.' : undefined}
            onChange={event => {
              setLength(event.target.value)
              setOutcome('')
            }}
          />
          <span aria-hidden="true">mm</span>
        </div>
        <p>Include any reducer or Barlow lens. Vela uses this to predict the camera’s field of view.</p>
      </div>
      <Button type="submit" tone="accent" disabled={locked} aria-busy={saving}>
        {saving ? 'Saving imaging setup…' : 'Save imaging setup'}
      </Button>
      {(notice || camera.error || focal.error || outcome) && (
        <div className="equipment__setup-notice" role="status">
          {notice && <p>{notice}</p>}
          {camera.error && <p>{camera.error}</p>}
          {focal.error && <p>{focal.error}</p>}
          {outcome && <p>{outcome}</p>}
        </div>
      )}
      {(uncertain || camera.error || focal.error || camera.offline || focal.offline) && (
        <Button type="button" disabled={saving || checking} onClick={() => void check()}>
          {checking ? 'Checking saved setup…' : 'Check saved setup'}
        </Button>
      )}
      <div className="equipment__setup-group equipment__divider">
        <p>Device connections and activity are read from the rig. Imaging setup is saved in Vela.</p>
        <Link to="/">Manage saved rigs</Link>
      </div>
    </form>
  )
}
