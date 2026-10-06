import type { RigDetailView, RigDeviceDetailView } from '@vela/model/web'
import { Button, Dialog } from '@vela/ui'
import { useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { loadHome } from '../features/home/load-home'
import { ImagingSetup } from '../features/imaging-camera/ImagingSetup'
import { useImagingCamera } from '../features/imaging-camera/use-imaging-camera'
import { ConnectionResult } from '../features/observation/RigReadiness'
import { readinessPresentation } from '../features/observation/presentation'
import { useObservation } from '../features/observation/use-observation'
import { RigDeviceRow } from '../features/rig-detail/RigDeviceRow'
import { useRigObservation } from '../features/rig-detail/RigContext'
import { forgetRig } from '../features/rig-management/forget-rig'
import './equipment.css'

export function RigDetail() {
  const { rigId } = useRigObservation()!

  return <Equipment key={rigId} rigId={rigId} />
}

function Equipment({ rigId }: { rigId: string }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { view, refreshing, interrupted, initialError, refresh } = useRigObservation()!
  const observation = useObservation(rigId)
  const camera = useImagingCamera(rigId)
  const [settingsPending, setSettingsPending] = useState(false)
  const [forgetOpen, setForgetOpen] = useState(false)
  const [forgetting, setForgetting] = useState(false)
  const [forgetUnconfirmed, setForgetUnconfirmed] = useState(false)
  const [forgetError, setForgetError] = useState('')
  const forgetRequest = useRef(false)
  const mounted = useRef(false)
  const cancelId = useId()
  const forgetId = useId()
  const base = `/rigs/${encodeURIComponent(rigId)}`
  const busy = observation.connecting || observation.view?.connectionPreparation.state === 'in-progress'
  const uncertain = observation.commandUnconfirmed || observation.result?.outcome === 'uncertain'

  useEffect(() => {
    mounted.current = true

    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    if (observation.completedCommands > 0) void refresh()
  }, [observation.completedCommands, refresh])

  function finishForget() {
    if (!mounted.current) return
    setForgetOpen(false)
    navigate('/', { replace: true })
  }

  async function confirmForget() {
    if (!view || forgetRequest.current || forgetUnconfirmed) return
    forgetRequest.current = true
    setForgetting(true)
    setForgetError('')

    try {
      const result = await forgetRig(view.id)

      if (result === 'confirmed') finishForget()
      else {
        setForgetUnconfirmed(result === 'unconfirmed')
        setForgetError(result === 'unconfirmed'
          ? 'The response could not be confirmed. Check saved rigs before another attempt; Vela has not repeated the request.'
          : 'The rig could not be forgotten. Check its current state before trying again.')
      }
    } finally {
      forgetRequest.current = false
      setForgetting(false)
    }
  }

  async function checkForget() {
    if (forgetRequest.current) return
    forgetRequest.current = true
    setForgetting(true)

    try {
      const current = await loadHome(AbortSignal.timeout(5000))

      if (!current.rigs.some(rig => rig.id === rigId)) finishForget()
      else {
        setForgetUnconfirmed(false)
        setForgetError('This rig is still saved in Vela. You can choose Forget rig again.')
      }
    } catch {
      setForgetError('Saved rigs could not be checked. The previous request has not been repeated.')
    } finally {
      forgetRequest.current = false
      setForgetting(false)
    }
  }

  if (!view) return (
    <section className="equipment equipment__route-state">
      <Link to="/">← All rigs</Link>
      {forgetUnconfirmed && <div role="status"><p>The previous Forget response is unconfirmed. Check saved rigs to establish whether it was removed.</p><Button disabled={forgetting} onClick={() => void checkForget()}>Check saved rigs</Button>{forgetError && <p>{forgetError}</p>}</div>}
      {!initialError ? <p role="status">Loading Rig…</p> : (
        <>
          <h1>{initialError === 'not-found' ? 'Rig not found' : 'Could not load this Rig'}</h1>
          <p>{initialError === 'not-found' ? 'This Rig is no longer saved in Vela, or the address is incorrect.' : 'Vela could not load this Rig. Check the server and try again.'}</p>
          {initialError !== 'not-found' && <Button disabled={refreshing} onClick={() => void refresh()}>Try again</Button>}
        </>
      )}
    </section>
  )

  const selected = camera.view?.selected

  const isSelected = (device: RigDeviceDetailView) => device.kind === 'camera' && device.id === camera.view?.selectedDeviceId && device.name === selected?.name
  const selectedDevice = view.devices.find(isSelected)
  const mountDevice = view.devices.find(device => device.kind === 'telescope')
  const cameraConnected = selectedDevice?.connection === 'connected' && !camera.offline && camera.view?.state === 'ready'
  const presentation = observation.view ? readinessPresentation(observation.view, busy, observation.interrupted) : null

  const title = uncertain ? 'The connection result is uncertain'
    : interrupted ? 'Live updates are interrupted'
      : view.state === 'offline' ? 'This Rig is offline'
        : busy ? 'Connecting devices…'
          : observation.interrupted ? 'Connection updates are interrupted'
            : cameraConnected ? 'Imaging camera connected'
              : selectedDevice?.connection === 'disconnected' ? 'Imaging camera disconnected'
                : presentation?.title ?? 'Checking device connections…'

  return (
    <section className="equipment" aria-label="Rig equipment">
      <header className="equipment__heading">
        <div><h1>Your rig</h1><span>{view.name}</span></div>
        <Link to={`${base}/observe/capture`}>← Back to Tonight</Link>
      </header>
      <div className="equipment__layout">
        <section className="equipment__readiness" aria-label="Rig readiness">
          <div role="status">
            <h2>{title}</h2>
            <p>{connectionSummary(view)}</p>
            {interrupted && <p>Showing the most recent values Vela received. They may no longer describe the Rig.</p>}
            {view.state === 'offline' && <p>Vela cannot reach {formatEndpoint(view)}. Device names come from the last successful inventory.</p>}
            {!cameraConnected && selectedDevice?.connection === 'disconnected' && <p>Saved photographs remain available.</p>}
            {uncertain && <p>Check current rig state before another connection. Vela has not repeated the command.</p>}
            {observation.interrupted && <p>Current connection state is unavailable. The values shown are last known.</p>}
            {observation.result && <ConnectionResult result={observation.result} />}
          </div>
          <div className="equipment__connection-actions">
            <Button tone="accent" disabled={!observation.canConnect || busy || interrupted || settingsPending} aria-busy={busy} onClick={() => void observation.connect()}>
              {busy ? 'Connecting devices…' : observation.result?.outcome === 'partial' || observation.result?.outcome === 'failed' ? 'Try remaining devices' : 'Connect devices'}
            </Button>
            {(uncertain || observation.interrupted || observation.error || observation.view?.connectionPreparation.state === 'unavailable') && (
              <Button disabled={observation.refreshing || busy} onClick={() => {
                void observation.refresh().then(() => refresh())
              }}>Check rig state</Button>
            )}
          </div>
        </section>
        <section className="equipment__devices" aria-label="Equipment">
          <header><h2>Equipment</h2><button className="equipment__text-action" disabled={refreshing} aria-busy={refreshing} onClick={() => void refresh()}>{refreshing ? 'Refreshing state…' : 'Refresh state'}</button></header>
          {view.devices.length === 0 ? <p>No devices are currently configured for this Rig.</p> : orderDevices(view.devices, selectedDevice?.id).map(device => (
            <RigDeviceRow
              key={device.id}
              device={device}
              stale={interrupted}
              imagingCamera={isSelected(device)}
              rigId={rigId}
              refresh={() => refresh({ force: true })}
              revealMount={device.id === mountDevice?.id && location.hash === '#mount-controls'}
            />
          ))}
        </section>
        <ImagingSetup rigId={rigId} camera={camera} interrupted={interrupted} connecting={busy || uncertain} onSaved={() => { void refresh() }} onPendingChange={setSettingsPending} />
        <section className="equipment__preparation" aria-label="Rig preparation">
          <p>Prepare the rig</p>
          <div>
            <Link className="vela-button" to={`${base}/observe/alignment`}>Polar alignment →</Link>
            <Link className="vela-button" to={`${base}/observe/autofocus`}>Autofocus →</Link>
          </div>
        </section>
      </div>
      <footer className="equipment__freshness">
        <span>{interrupted ? 'Last updated' : 'State checked'} {formatAge(view.refreshedAt)} · Disconnected devices have no live measurements</span>
      <details className="equipment__rig-details">
        <summary>Rig details</summary>
        <Link to={`${base}/observe`}>Capture preparation →</Link>
        <dl>
          <div><dt>Endpoint</dt><dd>{formatEndpoint(view)}</dd></div>
          <div><dt>Added to Vela</dt><dd>{formatDateTime(view.addedAt)}</dd></div>
          <div><dt>Last inventory</dt><dd>{formatDateTime(view.lastInventoryAt)}</dd></div>
        </dl>
        <div className="equipment__management">
          <p>Forget removes the saved rig from Vela. It does not change the Alpaca server or hardware.</p>
          {view.capabilities.includes('forget') && <Button id={forgetId} tone="quiet" disabled={settingsPending || busy} onClick={() => setForgetOpen(true)}>Forget rig</Button>}
        </div>
      </details>
      </footer>
      <Dialog
        className="equipment__forget-dialog"
        open={forgetOpen}
        title={`Forget ${view.name}?`}
        showCloseButton={false}
        initialFocusId={cancelId}
        returnFocusId={forgetId}
        onDismiss={forgetting ? undefined : () => setForgetOpen(false)}
        footer={<>
          <Button id={cancelId} disabled={forgetting} onClick={() => setForgetOpen(false)}>Cancel</Button>
          <Button tone="accent" disabled={forgetting} onClick={() => void (forgetUnconfirmed ? checkForget() : confirmForget())}>
            {forgetting ? 'Checking…' : forgetUnconfirmed ? 'Check saved rigs' : 'Forget rig'}
          </Button>
        </>}
      >
        <p>Remove this rig’s saved configuration from Vela. This does not change its ALPACA server or hardware. You can discover and add it again later.</p>
        {forgetError && <p role="alert">{forgetError}</p>}
      </Dialog>
    </section>
  )
}

function orderDevices(devices: ReadonlyArray<RigDeviceDetailView>, selectedId?: string) {
  const order = ['telescope', 'focuser', 'camera', 'filter-wheel', 'observing-conditions', 'switch']
  const rank = (device: RigDeviceDetailView) => device.id === selectedId ? -1 : order.indexOf(device.kind) < 0 ? order.length : order.indexOf(device.kind)

  return [...devices].sort((a, b) => rank(a) - rank(b))
}

function connectionSummary(view: RigDetailView) {
  const { connected, disconnected, total, unavailable } = view.connections
  const parts = [`${connected} of ${total} ${total === 1 ? 'device' : 'devices'} connected`]

  if (disconnected > 0) parts.push(`${disconnected} disconnected`)

  if (unavailable > 0) parts.push(`${unavailable} unavailable`)

  return parts.join(' · ')
}

function formatEndpoint(view: RigDetailView) {
  return `${view.endpoint.host}:${view.endpoint.port}`
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function formatAge(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000))

  if (seconds < 5) return 'just now'

  if (seconds < 60) return `${seconds} seconds ago`
  const minutes = Math.floor(seconds / 60)

  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`

  return formatDateTime(value)
}
