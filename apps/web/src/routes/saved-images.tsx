import type { SavedImage } from '@vela/model/web'
import { Button } from '@vela/ui'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { SelectedPhotograph } from '../features/photographs/SelectedPhotograph'
import { useSavedImage, useSavedImages } from '../features/photographs/use-saved-images'
import { photographDay, photographTime } from '../features/photographs/format'
import { pixelIdentity } from '../features/image-inspection/image-pixels'
import './saved-images.css'

export function SavedImages() {
  const { rigId = '', imageId } = useParams()

  return <PhotographsPage key={rigId} rigId={rigId} imageId={imageId} />
}

function PhotographsPage({ rigId, imageId }: { rigId: string; imageId?: string }) {
  const collection = useSavedImages(rigId)
  const selected = useSavedImage(rigId, imageId)
  const navigate = useNavigate()
  const [revealed, setRevealed] = useState(6)
  const listHeading = useRef<HTMLHeadingElement>(null)
  const rows = useRef<HTMLDivElement>(null)
  const viewer = useRef<HTMLElement>(null)
  const requestedFocus = useRef<string | null>(null)
  const base = `/rigs/${encodeURIComponent(rigId)}/observe/saved-images`
  const image = selected.view?.image
  const images = collection.view?.images ?? []
  const selectedIndex = images.findIndex(item => item.id === imageId)
  const visibleCount = Math.max(revealed, Math.ceil((selectedIndex + 1) / 6) * 6)
  const rigName = selected.view?.rigName ?? collection.view?.rigName
  const position = selectedIndex < 0 ? null : `Image ${images.length - selectedIndex} of ${images.length}`

  useEffect(() => {
    if (!imageId && images[0])
      void navigate(`${base}/${encodeURIComponent(images[0].id)}`, { replace: true })
  }, [imageId, images, base, navigate])

  useEffect(() => {
    if (visibleCount > revealed) setRevealed(visibleCount)

    if (selectedIndex < 6 || requestedFocus.current === imageId) return

    rows.current?.querySelector('[aria-current]')?.scrollIntoView({ block: 'nearest' })
  }, [imageId, selectedIndex, visibleCount, revealed])

  useEffect(() => {
    if (!imageId || requestedFocus.current !== imageId) return
    viewer.current?.focus({ preventScroll: true })
    viewer.current?.scrollIntoView({ block: 'nearest' })

    if (selected.view || selected.error) requestedFocus.current = null
  }, [imageId, selected.view, selected.error])

  const groups = new Map<string, SavedImage[]>()

  for (const listed of images.slice(0, visibleCount)) {
    const frame = image?.id === listed.id ? image : listed
    const day = photographDay(frame.capturedAt)
    const group = groups.get(day) ?? []
    group.push(frame)
    groups.set(day, group)
  }

  const nextReveal = Math.min(6, images.length - visibleCount)

  return (
    <article className="photographs">
      <header className="photographs__heading">
        <h1>Photographs</h1>
        {rigName && (
          <span>
            {rigName}{collection.view && ` · ${images.length} saved ${images.length === 1 ? 'image' : 'images'}`}
          </span>
        )}
        <p>Available even when the rig is disconnected</p>
      </header>
      {imageId && (
        <div className="photographs__jump">
          <span>{image ? `Selected · ${photographTime(image.capturedAt)}` : 'Selected photograph'}</span>
          <Button onClick={() => {
            listHeading.current?.focus({ preventScroll: true })
            listHeading.current?.scrollIntoView({ block: 'start' })
          }}>Jump to photographs ↓</Button>
        </div>
      )}
      <div
        className="photographs__layout"
        data-unselected={(!imageId && images.length === 0) || undefined}
      >
        <section className="photographs__list" aria-label="Photographs list">
          {images.length === 0 && <h2 className="photographs__list-title" tabIndex={-1} ref={listHeading}>Photographs list</h2>}
          {collection.loading && (
            images.length === 0 ? (
              <CollectionState state="loading" rigId={rigId} rigName={rigName} />
            ) : (
              <p role="status">Loading photographs…</p>
            )
          )}
          {collection.error && (
            <div className="photographs__read-status" role="status">
              <p>{collection.error}</p>
              <Button onClick={collection.refresh}>Retry photographs</Button>
            </div>
          )}
          {images.length > 0 && (
            <>
              <div className="photographs__rows" ref={rows}>
                {[...groups].map(([day, frames], groupIndex) => (
                  <section className="photographs__day" key={day}>
                    <header>
                      <h2 ref={groupIndex === 0 ? listHeading : undefined} tabIndex={-1}>{day}</h2>
                      {groupIndex === 0 && <span>Newest first</span>}
                    </header>
                    {frames.map(frame => (
                      <Link
                        key={frame.id}
                        to={`${base}/${encodeURIComponent(frame.id)}`}
                        aria-current={frame.id === imageId ? 'true' : undefined}
                        data-original={frame.previewRendering?.status !== 'current' || undefined}
                        onClick={event => {
                          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
                          requestedFocus.current = frame.id

                          if (frame.id === imageId) {
                            viewer.current?.focus({ preventScroll: true })
                            viewer.current?.scrollIntoView({ block: 'nearest' })

                            if (selected.view || selected.error) requestedFocus.current = null
                          }
                        }}
                      >
                        <img src={frame.fitImageUrl ?? frame.imageUrl} alt="" loading="lazy" />
                        <span>
                          <strong>{photographTime(frame.capturedAt)}</strong>
                          <small>{frame.exposureSeconds} s · {frame.color === 'color' ? 'Color' : 'Mono'}</small>
                          {frame.previewRendering?.status !== 'current' && <small>Original preview</small>}
                        </span>
                        <span aria-hidden="true">{frame.id === imageId ? '→' : ''}</span>
                      </Link>
                    ))}
                  </section>
                ))}
              </div>
              {nextReveal > 0 && (
                <Button onClick={() => {
                  setRevealed(visibleCount + nextReveal)

                  if (nextReveal === images.length - visibleCount) listHeading.current?.focus()
                }}>Show {nextReveal} earlier images</Button>
              )}
            </>
          )}
          {!collection.loading && collection.view && images.length === 0 && (
            <CollectionState state="empty" rigId={rigId} rigName={rigName} />
          )}
        </section>
        {image ? (
          <SelectedPhotograph
            key={pixelIdentity(image)}
            image={image}
            rigId={rigId}
            position={position}
            viewerRef={viewer}
          />
        ) : imageId ? (
          <section className="photographs__viewer photographs__pending" aria-label="Saved preview" tabIndex={-1} ref={viewer}>
            <div className="photographs__read-status" role="status">
              {selected.loading ? (
                <>
                  <h2>Preparing selected photograph</h2>
                  <p>Preparing the display preview from the retained original may take a moment.</p>
                </>
              ) : (
                <>
                  <h2>Selected photograph unavailable</h2>
                  <p>{selected.error}</p>
                  <Button onClick={selected.refresh}>Retry selected photograph</Button>
                </>
              )}
            </div>
          </section>
        ) : null}
      </div>
      <footer className="photographs__footer">
        Saved images belong to this rig. Select another rig to browse its photographs.
      </footer>
    </article>
  )
}

function CollectionState({
  state,
  rigId,
  rigName,
}: {
  state: 'loading' | 'empty'
  rigId: string
  rigName?: string
}) {
  const loading = state === 'loading'
  const context = loading ? 'Loading' : rigName

  return (
    <section
      className="photographs__collection-state"
      aria-label="Photographs collection state"
      aria-busy={loading}
    >
      <p className="photographs__context">
        Photographs{context ? ` · ${context}` : ''}
      </p>
      <div className="photographs__collection-copy">
        <h2>{loading ? 'Loading saved photographs' : 'No saved photographs yet'}</h2>
        <p className="photographs__collection-message">
          {loading
            ? 'Fetching this rig’s saved images. Your hardware does not need to be connected.'
            : 'Turn on Save frames before capturing, or use Keep to retain an exposure.'}
        </p>
      </div>
      <div className="photographs__collection-action">
        {loading ? (
          <p role="status">Loading photographs…</p>
        ) : (
          <Link
            className="vela-button"
            data-tone="accent"
            to={`/rigs/${encodeURIComponent(rigId)}/observe/capture`}
          >
            Open Tonight →
          </Link>
        )}
      </div>
    </section>
  )
}
