import type { FramingPreview } from '@vela/model/web'
import { Button, IconButton } from '@vela/ui'
import { useId, useRef, useState } from 'react'
import { CameraMark } from '../capture/LatestImage'
import { ImageEnlargement, ImageViewport } from '../image-inspection/ImageViewport'
import { useImageInspection } from '../image-inspection/useImageInspection'
import './framing-exposure.css'

export function FramingExposure({
  preview,
  compact = false,
}: {
  preview: FramingPreview | null
  compact?: boolean
}) {
  const pixels = preview?.previewUrl && preview.nativePreviewUrl
    ? { ...preview, imageUrl: preview.nativePreviewUrl, fitImageUrl: preview.previewUrl }
    : null

  const inspection = useImageInspection(pixels, {
    scope: `framing:${preview?.rigId ?? ''}:${preview?.targetId ?? ''}`,
  })

  const { frame, native, nativeVisible } = inspection
  const [expanded, setExpanded] = useState(false)
  const root = useRef<HTMLElement>(null)
  const inlineHeight = useRef<number | undefined>(undefined)
  const openerId = useId()

  const expand = () => {
    inlineHeight.current = root.current?.getBoundingClientRect().height
    inspection.hold()
    setExpanded(true)
  }

  const time = frame
    ? new Date(frame.capturedAt).toLocaleTimeString(undefined, { hour12: false })
    : null

  const controls = (
    <div className="framing-exposure__controls">
      <div role="group" aria-label="Image scale">
        <Button aria-pressed={!nativeVisible} onClick={inspection.showFit}>Fit</Button>
        <Button
          aria-pressed={nativeVisible}
          disabled={native.result?.state === 'missing'}
          onClick={inspection.showNative}
        >
          100%
        </Button>
      </div>
      {!expanded && (
        <IconButton
          id={openerId}
          label="Enlarge test exposure"
          icon={<span className="framing-exposure__enlarge-icon" aria-hidden="true">↗</span>}
          onClick={expand}
        />
      )}
    </div>
  )

  const viewport = (
    <ImageViewport
      inspection={inspection}
      expanded={expanded}
      alt={frame
        ? `${frame.exposureSeconds} second framing exposure from ${frame.cameraName}`
        : 'Framing exposure'}
      empty={(
        <div className="capture-image__empty">
          <CameraMark />
          <h3>
            {inspection.fitted.loading
              ? 'Loading test exposure'
              : preview
                ? 'Preview unavailable'
                : 'No test exposure yet'}
          </h3>
          <p>
            {preview
              ? 'The framing result is separate from its image preview.'
              : 'Check your composition to see the actual camera exposure here.'}
          </p>
        </div>
      )}
    />
  )

  const status = (
    <div className="framing-exposure__status">
      {inspection.held && (
        <p>
          Holding this test exposure.{' '}
          <Button onClick={inspection.showLatest}>Show latest test</Button>
        </p>
      )}
      {native.result?.state === 'loading' && (
        <p role="status">Loading full-resolution image… The fitted preview stays visible.</p>
      )}
      {native.result?.state === 'failed' && (
        <p role="status">
          Full-resolution preview could not be loaded.{' '}
          <Button onClick={native.retry}>Retry full-resolution image</Button>
        </p>
      )}
      {native.result?.state === 'missing' && (
        <p role="status">
          This temporary preview is no longer on the server. Loaded pixels remain available.
        </p>
      )}
      {!inspection.held && inspection.fitted.failed && (
        <p role="status">
          The test preview could not be loaded. {frame && 'The earlier test remains visible.'}{' '}
          <Button onClick={inspection.fitted.retry}>Retry test preview</Button>
        </p>
      )}
    </div>
  )

  const metadata = frame && (
    <div className="framing-exposure__metadata">
      <span>
        {frame.cameraName}{frame.capturedAtSource === 'server-estimate' ? ' · Start estimated' : ''}
      </span>
      <div>
        <div className="framing-exposure__facts">
          <span>{frame.exposureSeconds} s · Framing check</span>
          <span className="framing-exposure__hfr">
            Star size{'   '}{frame.statistics?.medianHfrPixels?.toFixed(1) ?? '—'} px HFR
          </span>
          <span>
            {frame.statistics ? `${frame.statistics.detectedStars} stars` : 'Star measurements unavailable'}
          </span>
        </div>
        <span>Temporary</span>
      </div>
    </div>
  )

  return (
    <section
      ref={root}
      className={`framing-exposure${compact ? ' framing-exposure--compact' : ''}`}
      aria-label="Last test exposure"
      style={expanded ? { minHeight: inlineHeight.current, boxSizing: 'border-box' } : undefined}
    >
      <header>
        <div>
          <h2>Last test exposure</h2>
          {time && <time dateTime={frame?.capturedAt}>{time}</time>}
        </div>
        {frame && (compact
          ? <Button id={openerId} tone="quiet" onClick={expand}>Inspect image ↗</Button>
          : controls)}
      </header>
      {!expanded && viewport}
      {compact ? frame && (
        <p className="framing-exposure__caption">
          {frame.exposureSeconds} s · {frame.checkId ? 'Solved exposure' : 'No solved position'} · Temporary
        </p>
      ) : metadata}
      {!expanded && status}

      <ImageEnlargement
        open={expanded}
        onDismiss={() => setExpanded(false)}
        rootRef={root}
        returnFocusId={openerId}
        title="Inspect test exposure"
      >
        {controls}
        {viewport}
        {metadata}
        {status}
      </ImageEnlargement>
    </section>
  )
}
