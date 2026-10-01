import type { SavedImage } from '@vela/model/web'
import { Button, IconButton } from '@vela/ui'
import { useId, useRef, useState, type RefObject } from 'react'
import { ImageEnlargement, ImageViewport } from '../image-inspection/ImageViewport'
import { useImageInspection } from '../image-inspection/useImageInspection'
import { photographDate, photographTime } from './format'

export function SelectedPhotograph({ image, rigId, position, viewerRef }: {
  image: SavedImage
  rigId: string
  position: string | null
  viewerRef: RefObject<HTMLElement | null>
}) {
  const inspection = useImageInspection(image, { scope: `photograph:${rigId}:${image.id}` })
  const displayed = inspection.frame ?? image
  const { fitted, native, nativeVisible } = inspection
  const [expanded, setExpanded] = useState(false)
  const inlineHeight = useRef<number | undefined>(undefined)
  const openerId = useId()
  const original = displayed.previewRendering?.status !== 'current'
  const fallback = displayed.previewRendering?.status === 'unavailable'

  const tools = (
    <div className="photographs__tools">
      <div role="group" aria-label="Image scale">
        <Button aria-pressed={!nativeVisible} onClick={inspection.showFit}>Fit</Button>
        <Button
          aria-pressed={nativeVisible}
          disabled={!inspection.frame}
          onClick={inspection.showNative}
        >
          100%
        </Button>
      </div>
      {!expanded && (
        <IconButton
          id={openerId}
          label="Enlarge image"
          disabled={!inspection.frame}
          icon={<span className="photographs__enlarge-icon" aria-hidden="true">↗</span>}
          onClick={() => {
            inlineHeight.current = viewerRef.current?.getBoundingClientRect().height
            inspection.hold()
            setExpanded(true)
          }}
        />
      )}
    </div>
  )

  const viewport = (
    <ImageViewport
      inspection={inspection}
      expanded={expanded}
      alt={`${displayed.exposureSeconds} second saved exposure from ${displayed.cameraName}`}
      empty={(
        <div className="photographs__empty-preview" role="status">
          <h2>{fitted.loading ? 'Loading saved preview' : 'Preview unavailable'}</h2>
          <p>The saved exposure details and original FITS remain available.</p>
        </div>
      )}
    />
  )

  const status = (
    <>
      {native.result?.state === 'loading' && (
        <p className="photographs__preview-status" role="status">
          Loading full-resolution image… The fitted preview stays visible.
        </p>
      )}
      {(native.result?.state === 'failed' || native.result?.state === 'missing') && (
        <div className="photographs__preview-status" role="status">
          <p>The full-resolution preview could not be loaded. The fitted preview and original FITS remain available.</p>
          <Button onClick={native.retry}>Retry full-resolution image</Button>
        </div>
      )}
      {fitted.failed && (
        <div className="photographs__preview-status" role="status">
          <p>The saved preview could not be loaded.</p>
          <Button onClick={fitted.retry}>Retry preview</Button>
        </div>
      )}
    </>
  )

  const caption = (
    <footer className="photographs__caption">
      <span>Saved exposure · {original ? 'Original preview' : 'Display preview'}</span>
      {position && <span>{position}</span>}
    </footer>
  )

  const fitsDownload = (
    <a className="vela-button" data-tone={fallback ? 'neutral' : 'accent'} href={displayed.fitsUrl} download>
      Download original FITS ↓
    </a>
  )

  return (
    <>
      <section
        className="photographs__viewer"
        aria-label="Saved preview"
        tabIndex={-1}
        ref={viewerRef}
        style={expanded ? { minHeight: inlineHeight.current } : undefined}
      >
        <header>
          <time dateTime={displayed.capturedAt}>
            {photographDate(displayed.capturedAt, false)} · {photographTime(displayed.capturedAt)}
          </time>
          {!expanded && tools}
        </header>
        {!expanded && <>{viewport}{caption}{status}</>}
        <ImageEnlargement
          open={expanded}
          onDismiss={() => setExpanded(false)}
          rootRef={viewerRef}
          returnFocusId={openerId}
          title="Photograph inspection"
        >
          <div className="photographs__enlarged">
            {tools}
            {viewport}
            {caption}
            {status}
          </div>
        </ImageEnlargement>
      </section>
      <section className="photographs__details" aria-label="Exposure details">
        <header>
          <h2>Exposure details</h2>
          <p>Saved on this Vela server</p>
        </header>
        <dl>
          <div>
            <dt>Captured</dt>
            <dd>
              {photographDate(displayed.capturedAt)} · {photographTime(displayed.capturedAt)}
              {displayed.capturedAtSource === 'server-estimate' && ' · Start time estimated'}
            </dd>
          </div>
          <div><dt>Camera</dt><dd>{displayed.cameraName}</dd></div>
          <div>
            <dt>Exposure</dt>
            <dd>{displayed.exposureSeconds} seconds · {displayed.color === 'color' ? 'Color' : 'Mono'}</dd>
          </div>
          <div><dt>Dimensions</dt><dd>{displayed.width} × {displayed.height} px</dd></div>
          <div>
            <dt>Stars · HFR</dt>
            <dd>
              {displayed.statistics
                ? `${displayed.statistics.detectedStars} stars · ${displayed.statistics.medianHfrPixels === null ? 'HFR unavailable' : `${displayed.statistics.medianHfrPixels.toFixed(2)} px`}`
                : 'Measurements unavailable'}
            </dd>
          </div>
        </dl>
        <div className="photographs__downloads">
          {fallback ? (
            <aside className="photographs__fallback">
              <p className="photographs__context">Saved photograph · Preview fallback</p>
              <h3>Showing the original preview</h3>
              <p>The updated preview could not be generated. The original FITS file is unchanged and still available to download.</p>
              {fitsDownload}
            </aside>
          ) : fitsDownload}
          <a className="vela-button" data-tone="neutral" href={displayed.previewDownloadUrl} download>
            Download {original ? 'original preview' : 'display'} PNG ↓
          </a>
          {!fallback && <p>The FITS file retains the original capture data.</p>}
        </div>
      </section>
    </>
  )
}
