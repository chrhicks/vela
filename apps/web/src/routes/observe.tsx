import type { ConnectRigDevicesResult } from '@vela/model/web'
import { Badge, Button, Panel } from '@vela/ui'
import { useEffect, useRef } from 'react'
import { Link, useParams } from 'react-router'
import { readinessPresentation } from '../features/observation/presentation'
import { useObservation } from '../features/observation/use-observation'
import { ImagingCamera } from '../features/imaging-camera/ImagingCamera'
import { CaptureHub } from '../features/capture/CaptureHub'
import '../routes/capture.css'
import { ConnectionMark } from '../features/observation/ObservationMark'
import './observe.css'

export function Observe() {
  const { rigId = '' } = useParams()
  return <ObservationPage key={rigId} rigId={rigId} />
}

function ObservationPage({ rigId }: { rigId: string }) {
  const observation = useObservation(rigId)
  const heading = useRef<HTMLHeadingElement>(null)
  const { view, result, connecting, refreshing, interrupted, commandUnconfirmed, completedCommands } = observation
  useEffect(() => {
    if (completedCommands > 0) heading.current?.focus()
  }, [completedCommands])

  const back = <Link className="vela-rig-page__back" to={`/rigs/${encodeURIComponent(rigId)}`}>← Rig details</Link>
  if (!view) return <section className="vela-rig-page">
    {back}
    {observation.error ? <div className="vela-rig-route-state" role="status">
      <h1>{observation.error === 'not-found' ? 'Rig not found' : 'Could not load this Rig'}</h1>
      <p>{observation.error === 'not-found' ? 'This Rig is no longer saved, or the address is incorrect.' : 'Vela could not confirm the observation response. Check the server and try again.'}</p>
      {observation.error !== 'not-found' && <Button disabled={refreshing} onClick={() => void observation.refresh()}>Try again</Button>}
    </div> : <p role="status">Loading Rig readiness…</p>}
  </section>

  const busy = connecting || (!interrupted && view.connectionPreparation.state === 'in-progress')
  const presentation = readinessPresentation(view, connecting, interrupted)
  const uncertain = commandUnconfirmed || result?.outcome === 'uncertain'
  const title = uncertain && !busy ? 'The connection result is uncertain' : presentation.title
  const { rig } = view

  return <section className="vela-rig-page vela-observe vela-observe-hub">
    {back}
    <header className="capture-page__heading">
      <div><p>{rig.name}</p><h1>Observe</h1></div>
      <Badge marker={<i />} tone={uncertain ? 'warning' : presentation.tone}>{uncertain ? 'Confirmation needed' : presentation.badge}</Badge>
    </header>
    <p className="vela-capture-intro">{interrupted ? 'Waiting for rig updates. The information shown is last known.' : view.connectionPreparation.state === 'complete' ? 'Connection preparation is complete. What would you like to do?' : 'Check your rig’s connections, then choose an activity.'}</p>
    <details className="capture-page__rig vela-capture-rig" open={busy || uncertain || interrupted || view.connectionPreparation.state !== 'complete' ? true : undefined}>
      <summary><span><i data-offline={interrupted || undefined} />{title}</span><span>Device details</span></summary>
    <div className="vela-observe-section-heading">
      <div><small>Preparation</small><h2>Rig readiness</h2></div>
      <span>{interrupted || busy ? 'Last received' : 'Checked'} <time dateTime={rig.refreshedAt}>{new Date(rig.refreshedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time></span>
    </div>
    <div className="vela-observe-grid">
      <Panel className="vela-observe-readiness" elevation="raised" data-tone={uncertain ? 'warning' : presentation.tone}>
        <div className="vela-observe-summary">
          <span aria-hidden="true" className="vela-observe-mark">{uncertain || interrupted ? <span>!</span> : <ConnectionMark busy={busy} tone={presentation.tone} />}</span>
          <div role="status" aria-live="polite" aria-atomic="true">
            <h3 ref={heading} tabIndex={-1}>{title}</h3>
            <p>{uncertain && !busy ? 'Check current Rig state before trying another connection. Vela has not repeated the command.' : presentation.description}</p>
          </div>
        </div>
        {commandUnconfirmed && <p className="vela-observe-warning">The command response could not be confirmed. A fresh state check does not prove how that command ended.</p>}
        {interrupted && uncertain && <p>Current state is also unavailable. The values shown are last known.</p>}
        {result && <ConnectionResult result={result} />}
        <div className="vela-observe-actions">
          {busy ? <Button disabled aria-busy="true" size="large" tone="accent">Connecting devices…</Button>
            : observation.canConnect ? <Button onClick={() => void observation.connect()} size="large" tone="accent">{result?.outcome === 'partial' || result?.outcome === 'failed' ? 'Try remaining devices' : 'Connect devices'}</Button>
              : null}
          <Button disabled={connecting || refreshing} onClick={() => void observation.refresh()}>{refreshing ? 'Checking Rig…' : 'Check Rig again'}</Button>
        </div>
        <p className="vela-observe-note">{busy ? 'Vela connects devices one at a time and stops if a result cannot be established.' : 'Connection is an explicit preparation action. Checking the Rig only reads current state.'}</p>
      </Panel>
      <Panel className="vela-observe-facts" title="What Vela can confirm" elevation="flat">
        <dl>
          <div><dt>Rig</dt><dd>{interrupted || busy ? 'Last known state' : rig.state === 'offline' ? 'Offline' : 'Reachable'}</dd></div>
          <div><dt>Device connections</dt><dd>{busy ? 'Status updating' : `${rig.connections.connected} confirmed connected`}</dd></div>
          <div><dt>Other device states</dt><dd>{busy ? 'Status updating' : `${rig.connections.disconnected} disconnected · ${rig.connections.unavailable} unavailable`}</dd></div>
        </dl>
        <p>{rig.endpoint.host}:{rig.endpoint.port}</p>
        <p>Opening this workspace does not start an exposure or save an observation.</p>
      </Panel>
    </div>
    </details>
    <ImagingCamera rigId={rigId} interrupted={interrupted} connecting={busy} />
    <CaptureHub rigId={rigId} />
  </section>
}

function ConnectionResult({ result }: { result: ConnectRigDevicesResult }) {
  if (result.outcome === 'unavailable') return <p className="vela-observe-warning">Connection was unavailable: {result.reason === 'identity-conflict' ? 'the Rig identity changed.' : result.reason === 'offline' ? 'the Rig was offline.' : 'device state could not be confirmed.'}</p>
  if (result.outcome === 'complete') return <p>Last connection attempt: {result.command === 'not-needed' ? 'no connection commands were needed.' : `${result.confirmedConnected.length} device connections confirmed.`}</p>
  return <section className="vela-observe-result" aria-label="Last connection attempt">
    <h4>Last connection attempt</h4>
    <dl>
      <div><dt>Confirmed connected</dt><dd>{result.confirmedConnected.map((device) => device.name).join(' · ') || 'None confirmed by this attempt'}</dd></div>
      {'failed' in result && <div><dt>Connection failed</dt><dd>{result.failed.name} — {result.failed.reason === 'rejected' ? 'connection rejected' : result.failed.reason === 'remained-disconnected' ? 'remained disconnected' : result.failed.reason === 'device-not-found' ? 'device not found' : 'connection check failed'}</dd></div>}
      {'uncertain' in result && <div><dt>Not confirmed</dt><dd>{result.uncertain.name}</dd></div>}
      {'stoppedAfter' in result && <div><dt>Stopped after</dt><dd>{result.stoppedAfter.name} — confirmed by a later state check; sequencing had already stopped.</dd></div>}
      <div><dt>Not attempted</dt><dd>{result.notAttempted.map((device) => device.name).join(' · ') || 'None'}</dd></div>
    </dl>
  </section>
}
