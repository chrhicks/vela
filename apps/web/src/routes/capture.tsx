import { Badge, Button, Input, Panel } from '@vela/ui'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { CameraMark, LatestImage } from '../features/capture/LatestImage'
import { captureActivity, useCapture } from '../features/capture/use-capture'
import './capture.css'

export function Capture() {
  const { rigId = '' } = useParams()
  return <CapturePage key={rigId} rigId={rigId} />
}

function CapturePage({ rigId }: { rigId: string }) {
  const capture = useCapture(rigId)
  const [exposure, setExposure] = useState<string | null>(null)
  const { view, offline, pending, refreshing, error, commandUnconfirmed } = capture
  const exposureValue = view?.active ? String(view.exposureSeconds) : exposure ?? String(view?.exposureSeconds ?? 2)
  const seconds = Number(exposureValue)
  const validExposure = exposureValue.trim() !== '' && Number.isFinite(seconds) && seconds >= 0.1 && seconds <= 600
  const back = <Link className="vela-rig-page__back" to={`/rigs/${encodeURIComponent(rigId)}/observe`}>← Observe</Link>

  if (!view) return <section className="vela-rig-page capture-page">
    {back}<h1>Capture</h1>
    {offline ? <div role="status"><p>{error ?? 'Capture state is unavailable. Check that the Vela server is reachable.'}</p><Button disabled={refreshing} onClick={() => void capture.refresh()}>Check capture state</Button></div>
      : <p role="status">Loading capture state…</p>}
  </section>

  const busy = view.active || pending
  const activity = pending ? 'Sending command' : captureActivity(view, offline)
  const warning = error ?? (offline ? 'Capture status is unknown. Waiting for the rig to reconnect.' : view.error ?? view.unavailableReason)

  return <section className="vela-rig-page capture-page">
    {back}
    <header className="capture-page__heading">
      <div><p>{view.rigName}</p><h1>Capture</h1></div>
      <Badge tone={offline || commandUnconfirmed ? 'warning' : busy ? 'accent' : view.enabled ? 'positive' : 'neutral'}>{offline ? 'Last known' : commandUnconfirmed ? 'Confirmation needed' : busy ? 'Capturing' : view.enabled ? 'Connected' : 'Unavailable'}</Badge>
    </header>
    {warning && <div className="capture-page__warning" role="status">
      <strong>{commandUnconfirmed ? 'Command outcome unknown' : offline ? 'Connection interrupted' : view.phase === 'failed' ? 'Exposure failed' : 'Capture unavailable'}</strong>
      <p>{warning}{view.latestImage ? ' The last image is kept below.' : ''}</p>
      {commandUnconfirmed && <Button disabled={pending || refreshing} onClick={() => void capture.refresh()}>{refreshing ? 'Checking capture state…' : 'Check capture state'}</Button>}
    </div>}
    <div className="capture-page__layout">
      <LatestImage image={view.latestImage} busy={busy} interrupted={offline || commandUnconfirmed || !view.enabled} />
      <Panel className="capture-page__controls" title="Take an exposure">
        <div className="capture-page__camera"><CameraMark /><div><strong>{view.camera?.name ?? 'No camera available'}</strong>{view.camera && <span>Imaging camera</span>}</div></div>
        <form onSubmit={event => { event.preventDefault(); if (validExposure) void capture.start(seconds) }}>
          <Input label="Exposure · seconds" type="number" min="0.1" max="600" step="0.1" value={exposureValue}
            disabled={busy || offline} invalid={!validExposure} message={validExposure ? '' : 'Choose 0.1–600 seconds.'}
            onChange={event => setExposure(event.target.value)} />
          <div className="capture-page__command">
            {view.phase === 'exposing' ? <Button type="button" size="large" disabled={!capture.canStop} onClick={() => void capture.stop()}>Stop exposure</Button>
              : <Button type="submit" size="large" tone="accent" disabled={!capture.canStart || !validExposure}>{pending ? 'Sending command…' : view.phase === 'reading' ? 'Receiving image…' : view.phase === 'stopping' ? 'Stopping exposure…' : 'Take exposure'}</Button>}
          </div>
        </form>
        <div className="capture-page__progress">
          <div><strong role="status">{activity}</strong>{view.phase === 'exposing' && <span>{view.elapsedSeconds.toFixed(1)} / {view.exposureSeconds} s</span>}</div>
          {view.phase === 'exposing' && <progress value={Math.min(1, view.elapsedSeconds / view.exposureSeconds)} max="1" aria-label={offline ? 'Last known exposure progress' : 'Exposure progress'} />}
          <p>{busy ? view.latestImage ? 'The previous image stays visible until the new one arrives.' : 'The image will appear when the exposure is received.' : view.phase === 'stopped' ? 'No new image was added.' : 'One exposure at a time. The latest image stays here.'}</p>
        </div>
      </Panel>
    </div>
    <details className="capture-page__rig">
      <summary><span><i data-offline={offline || !view.enabled || undefined} />{offline ? 'Rig updates interrupted' : view.camera ? view.camera.name : 'Camera unavailable'}</span><span>Device details</span></summary>
      <p>{offline ? 'Last known capture state' : view.active ? activity : view.enabled ? 'Camera ready for capture' : view.unavailableReason ?? 'Camera unavailable'}</p>
      <Link to={`/rigs/${encodeURIComponent(rigId)}`}>Open Rig details →</Link>
    </details>
  </section>
}
