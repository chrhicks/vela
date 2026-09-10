import { Badge, Button, Checkbox, Input, Panel } from '@vela/ui'
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
  const [saveFrames, setSaveFrames] = useState<boolean | null>(null)
  const [repeat, setRepeat] = useState<boolean | null>(null)
  const { view, offline, pending, refreshing, error, commandUnconfirmed } = capture
  const exposureValue = view?.active ? String(view.exposureSeconds) : exposure ?? String(view?.exposureSeconds ?? 2)
  const repeating = view?.active ? view.repeat : repeat ?? view?.repeat ?? true
  const savingFrames = view?.active ? view.saveFrames : saveFrames ?? false
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
      <div className="capture-page__heading-actions"><Link className="vela-button" data-tone="neutral" data-size="medium" to={`/rigs/${encodeURIComponent(rigId)}/observe/saved-images`}>Saved images{view.savedImageCount !== null ? ` (${view.savedImageCount})` : ''} →</Link>
        <Badge tone={offline || commandUnconfirmed ? 'warning' : busy ? 'accent' : view.enabled ? 'positive' : 'neutral'}>{offline ? 'Last known' : commandUnconfirmed ? 'Confirmation needed' : busy ? 'Capturing' : view.enabled ? 'Connected' : 'Unavailable'}</Badge></div>
    </header>
    {warning && <div className="capture-page__warning" role="status">
      <strong>{commandUnconfirmed ? 'Command outcome unknown' : offline ? 'Connection interrupted' : view.phase === 'failed' ? 'Capture stopped' : 'Capture unavailable'}</strong>
      <p>{warning}{view.latestImage ? ' The last image is kept below.' : ''}</p>
      {commandUnconfirmed && <Button disabled={pending || refreshing} onClick={() => void capture.refresh()}>{refreshing ? 'Checking capture state…' : 'Check capture state'}</Button>}
    </div>}
    <div className="capture-page__layout">
      <LatestImage rigId={rigId} image={view.latestImage} busy={busy} interrupted={offline || commandUnconfirmed || !view.enabled} />
      <Panel className="capture-page__controls" title="Capture images">
        <div className="capture-page__camera"><CameraMark /><div><strong>{view.camera?.name ?? 'No camera available'}</strong>{view.camera && <span>Imaging camera</span>}</div></div>
        <form onSubmit={event => { event.preventDefault();

 if (validExposure) void capture.start(seconds, repeating, savingFrames) }}>
          <Input label="Exposure · seconds" type="number" min="0.1" max="600" step="0.1" value={exposureValue}
            disabled={busy || offline} invalid={!validExposure} message={validExposure ? '' : 'Choose 0.1–600 seconds.'}
            onChange={event => setExposure(event.target.value)} />
          <Checkbox label="Repeat until stopped" checked={repeating} disabled={busy || offline} onChange={event => setRepeat(event.target.checked)} />
          <Checkbox label="Save frames" description="Keep every completed image as FITS + preview." checked={savingFrames} disabled={busy || offline} onChange={event => setSaveFrames(event.target.checked)} />
          <div className="capture-page__command">
            {view.active ? <Button type="button" size="large" disabled={!capture.canStop} onClick={() => void capture.stop()}>{pending ? 'Sending command…' : view.phase === 'stopping' ? 'Stopping capture…' : view.repeat ? 'Stop run' : 'Stop exposure'}</Button>
              : <Button type="submit" size="large" tone="accent" disabled={!capture.canStart || !validExposure}>{pending ? 'Sending command…' : repeating ? 'Start run' : 'Take exposure'}</Button>}
          </div>
        </form>
        {(view.active || view.completedCount > 0 || view.phase === 'stopped' || view.phase === 'failed') && <div className="capture-page__count"><strong>{view.completedCount}</strong><span>{view.completedCount === 1 ? 'image completed' : 'images completed'}{offline ? ' · last known' : ''}</span></div>}
        <div className="capture-page__progress">
          <div><strong role="status">{activity}</strong>{view.phase === 'exposing' && <span>{view.elapsedSeconds.toFixed(1)} / {view.exposureSeconds} s</span>}</div>
          {view.phase === 'exposing' && <progress value={Math.min(1, view.elapsedSeconds / view.exposureSeconds)} max="1" aria-label={offline ? 'Last known exposure progress' : 'Exposure progress'} />}
          <p>{view.phase === 'saving' ? 'Saving this image before the next exposure. Stop waits for this save to finish.' : view.phase === 'stopping' ? 'Waiting for the camera to confirm it has stopped.' : busy ? view.phase === 'reading' ? repeating ? 'Receiving this exposure before starting the next.' : 'Receiving the completed exposure.' : repeating ? `Exposure ${view.completedCount + 1}. Stop cancels the unfinished exposure.` : 'The previous image stays visible until the new one arrives.' : view.phase === 'stopped' ? 'The last completed image is kept. Start again when ready.' : repeating ? 'Keeps capturing until you stop. You can leave this page during the run.' : 'Take one image and stop.'}</p>
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
