import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Panel } from '@vela/ui'
import { useCapture } from './use-capture'
import { coolingSummary } from './CaptureCooling'
import { useLoadedImage } from './LatestImage'
import './capture-hub.css'

export function CaptureHub({ rigId }: { rigId: string }) {
  const { view, offline } = useCapture(rigId)
  const { loadedImage: image, loadedUrl, failed, loading } = useLoadedImage(view?.latestImage ?? null)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)

    return () => clearInterval(timer)
  }, [])
  const base = `/rigs/${encodeURIComponent(rigId)}/observe`
  const age = image ? Math.max(0, Math.floor((now - Date.parse(image.receivedAt)) / 1000)) : 0

  return <div className="vela-capture-hub">
    <Panel className="vela-capture-entry" elevation="raised">
      <div className="vela-capture-entry__preview">
        {image ? <img src={loadedUrl} alt={`Latest completed exposure from ${image.cameraName}`} /> : <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="6" y="12" width="36" height="26" rx="5" /><path d="m15 12 3-5h12l3 5" /><circle cx="24" cy="25" r="8" /></svg>}
        <span>{image ? 'Latest exposure' : 'See what your camera sees'}</span>
      </div>
      <div className="vela-capture-entry__body">
        <h2>Capture</h2><p>Capture images and inspect the latest exposure.</p>
        <div className="vela-capture-entry__status" role="status">
          {offline ? 'Capture updates interrupted · last known state' : view?.captureReadState === 'retrying' ? 'Camera observation interrupted · Retrying reads for the same exposure' : view?.active ? view.phase === 'stopping' ? 'Stopping capture…' : view.phase === 'saving' ? 'Saving image…' : view.phase === 'reading' ? 'Receiving image…' : 'Exposing…' : view?.phase === 'failed' ? 'Capture stopped' : view?.phase === 'stopped' ? 'Capture stopped' : !view ? 'Loading capture state…' : !view.enabled ? view.unavailableReason : !image ? loading ? 'Loading latest image…' : 'No image captured yet' : null}
          {view?.active && <span>{view.completedCount} completed{offline ? ' · last known' : ''}</span>}
          {coolingSummary(view?.cooling) && <span>{coolingSummary(view?.cooling)}{offline ? ' · last known' : ''}</span>}
          {image && <span>{image.exposureSeconds} s · {age} s ago</span>}
          {failed && <span>The latest image could not be loaded.</span>}
        </div>
        <Link className="vela-button" data-tone="accent" data-size="large" to={`${base}/capture`}>{view?.active ? 'View capture' : 'Open capture'} →</Link>
      </div>
    </Panel>
    <Panel className="vela-capture-entry"><div className="vela-capture-entry__body"><h2>Saved images</h2><p>Your retained frames, ready to browse and take into your processing tools.</p><div className="vela-capture-entry__status">{view?.savedImageCount != null ? `${view.savedImageCount} images · ` : ''}Original FITS + preview{offline ? ' · Last known count' : ''}</div><Link className="vela-button" data-tone="neutral" data-size="medium" to={`${base}/saved-images`}>Browse saved images →</Link></div></Panel>
    <Panel className="vela-capture-alignment">
      <div className="vela-capture-alignment__mark" aria-hidden="true">◎</div>
      <h2>Polar alignment</h2><p>Measure your alignment and adjust the mount when you need to.</p>
      <Link to={`${base}/alignment`}>Open polar alignment <span aria-hidden="true">→</span></Link>
    </Panel>
    <Panel className="vela-capture-alignment">
      <div className="vela-capture-alignment__mark" aria-hidden="true">V</div>
      <h2>Autofocus</h2><p>Walk a small window around the current focuser position and watch the V-curve as shorts land.</p>
      <Link to={`${base}/autofocus`}>Open autofocus <span aria-hidden="true">→</span></Link>
    </Panel>
  </div>
}
