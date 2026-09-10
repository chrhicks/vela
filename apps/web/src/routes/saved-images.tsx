import type { SavedImage, SavedImagesView } from '@vela/model/web'
import { Button, Panel } from '@vela/ui'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api, ApiError } from '../lib/api'
import { isSavedImageView, isSavedImagesView } from '../features/capture/validation'
import { LatestImage } from '../features/capture/LatestImage'
import './capture.css'
import './saved-images.css'

export function SavedImages() {
  const { rigId = '', imageId } = useParams()

  return <SavedImagesPage key={`${rigId}/${imageId ?? ''}`} rigId={rigId} imageId={imageId} />
}

function SavedImagesPage({ rigId, imageId }: { rigId: string, imageId?: string }) {
  const [view, setView] = useState<SavedImagesView | null>(null)
  const [image, setImage] = useState<SavedImage | null>(null)
  const [rigName, setRigName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [loading, setLoading] = useState(true)
  const base = `/rigs/${encodeURIComponent(rigId)}/observe`
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    async function load() {
      try {
        const result = await api<unknown>(`web/rigs/${encodeURIComponent(rigId)}/saved-images${imageId ? `/${encodeURIComponent(imageId)}` : ''}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) })

        if (controller.signal.aborted) return

        if (imageId) {
          if (!isSavedImageView(result, rigId) || result.image.id !== imageId) throw new Error('Invalid saved image')
          setImage(result.image)
          setRigName(result.rigName)
        } else {
          if (!isSavedImagesView(result, rigId)) throw new Error('Invalid saved images')
          setView(result)
          setRigName(result.rigName)
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof ApiError && cause.status === 404 ? 'This saved image or Rig could not be found.' : 'Saved images could not be loaded. Check that the Vela server is reachable, then try again.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void load()

    return () => controller.abort()
  }, [rigId, imageId, attempt])
  const groups = new Map<string, SavedImage[]>()

  for (const frame of [...(view?.images ?? [])].sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))) {
    const day = new Date(frame.capturedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    groups.set(day, [...(groups.get(day) ?? []), frame])
  }

  return <section className="vela-rig-page capture-page saved-images-page">
    <Link className="vela-rig-page__back" to={imageId ? `${base}/saved-images` : base}>← {imageId ? 'Saved images' : 'Observe'}</Link>
    <header className="capture-page__heading"><div>{rigName && <p>{rigName}</p>}<h1>{imageId ? 'Saved image' : 'Saved images'}</h1></div>{view && <span className="vela-saved-count">{view.images.length} {view.images.length === 1 ? 'image' : 'images'}</span>}</header>
    {loading ? <p role="status">Loading saved {imageId ? 'image' : 'images'}…</p> : error ? <div role="status"><p>{error}</p><Button onClick={() => setAttempt(value => value + 1)}>Try again</Button></div> : image ? <div className="capture-page__layout">
      <LatestImage image={image} busy={false} interrupted={false} savedDetail />
      <Panel title="Image details"><dl className="vela-saved-details">
        <div><dt>Captured</dt><dd>{new Date(image.capturedAt).toLocaleString()}{image.capturedAtSource === 'server-estimate' && ' · Start time estimated'}</dd></div>
        <div><dt>Camera</dt><dd>{image.cameraName}</dd></div>
        <div><dt>Exposure</dt><dd>{image.exposureSeconds} s · {image.color === 'color' ? 'Color' : 'Mono'}</dd></div>
        <div><dt>Dimensions</dt><dd>{image.width} × {image.height}</dd></div>
        <div><dt>Stars · HFR</dt><dd>{image.statistics ? `${image.statistics.detectedStars} stars · ${image.statistics.medianHfrPixels?.toFixed(2) ?? '—'} px` : 'Measurements unavailable'}</dd></div>
      </dl><div className="vela-saved-downloads"><a className="vela-button" data-tone="accent" data-size="medium" href={image.fitsUrl} download>Download FITS</a><a className="vela-button" data-tone="neutral" data-size="medium" href={image.previewDownloadUrl} download>Download preview</a></div><p className="vela-saved-help">Use the original FITS in Siril or your preferred processing tool.</p></Panel>
    </div> : view && <>
      <p className="vela-capture-intro">Original data and the preview you inspected, kept on your Vela server.</p>
      {view.images.length === 0 ? <Panel><div className="vela-saved-empty"><h2>No saved images yet</h2><p>Turn on Save frames before capturing, or keep an individual image when you see one worth saving.</p><Link className="vela-button" data-tone="neutral" data-size="medium" to={`${base}/capture`}>Open capture →</Link></div></Panel> : [...groups].map(([day, frames]) => <section className="vela-saved-group" key={day}><h2>{day}<span>{frames.length} {frames.length === 1 ? 'image' : 'images'}</span></h2><div className="vela-saved-grid">{frames.map(frame => <Link className="vela-saved-card" key={frame.id} to={`${base}/saved-images/${encodeURIComponent(frame.id)}`}><div className="vela-saved-thumbnail"><img loading="lazy" src={frame.fitImageUrl ?? frame.imageUrl} alt={`${frame.exposureSeconds} second exposure from ${frame.cameraName}`} /></div><div className="vela-saved-card-copy"><strong>{new Date(frame.capturedAt).toLocaleTimeString()}</strong><span>{frame.exposureSeconds} s · {frame.color === 'color' ? 'Color' : 'Mono'}</span><small>FITS + preview <span aria-hidden="true">→</span></small></div></Link>)}</div></section>)}
    </>}
  </section>
}
