import type { SavedImage } from '@vela/model/web'
import { Button, Select } from '@vela/ui'
import { useEffect, useMemo, useRef, type MouseEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { PhotographGrid, PhotographGroups } from '../features/photographs/PhotographLibrary'
import { SelectedPhotograph } from '../features/photographs/SelectedPhotograph'
import { useSavedImage, useSavedImages } from '../features/photographs/use-saved-images'
import { groupPhotographs, photographNight, photographNightTitle, photographTarget } from '../features/photographs/library'
import type { PhotographBrowse } from '../features/photographs/library'
import { pixelIdentity } from '../features/image-inspection/image-pixels'
import './saved-images.css'

const noImages: SavedImage[] = []

type BrowseSelection = { browse: PhotographBrowse; group: string; filter: string; query: string }

type FocusDestination = 'library' | 'group' | 'image'

export function SavedImages() {
  const { rigId = '', imageId } = useParams()

  return <PhotographsPage key={rigId} rigId={rigId} imageId={imageId} />
}

function PhotographsPage({ rigId, imageId }: { rigId: string; imageId?: string }) {
  const collection = useSavedImages(rigId)
  const selected = useSavedImage(rigId, imageId)
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const library = useRef<HTMLDivElement>(null)
  const groupHeading = useRef<HTMLHeadingElement>(null)
  const viewer = useRef<HTMLElement>(null)
  const requestedFocus = useRef<FocusDestination | null>(null)
  const base = `/rigs/${encodeURIComponent(rigId)}/observe/saved-images`
  const image = selected.view?.image
  const listedImages = collection.view?.images ?? noImages

  const images = useMemo(() => image
    ? listedImages.map(listed => listed.id === image.id ? image : listed)
    : listedImages, [listedImages, image])

  const timeZone = collection.view?.timeZone ?? selected.view?.timeZone ?? 'UTC'
  const browse: PhotographBrowse = params.get('browse') === 'targets' ? 'targets' : 'nights'
  const groups = useMemo(() => groupPhotographs(images, browse, timeZone), [images, browse, timeZone])
  const selectedMetadata = image ?? images.find(item => item.id === imageId)

  const inferredGroup = selectedMetadata
    ? browse === 'nights' ? photographNight(selectedMetadata.capturedAt, timeZone) : photographTarget(selectedMetadata).id
    : ''

  const groupId = params.get('group') ?? (imageId ? inferredGroup : '')
  const group = groups.find(item => item.id === groupId)
  const opposite = browse === 'nights' ? 'targets' : 'nights'
  const filters = useMemo(() => groupPhotographs(group?.images ?? noImages, opposite, timeZone), [group, opposite, timeZone])
  const filter = filters.some(item => item.id === params.get('filter')) ? params.get('filter')! : ''
  const visible = filter ? filters.find(item => item.id === filter)!.images : group?.images ?? noImages
  const selectedIndex = visible.findIndex(item => item.id === imageId)
  const selection: BrowseSelection = { browse, group: groupId, filter, query: params.get('q') ?? '' }
  const rigName = selected.view?.rigName ?? collection.view?.rigName
  const groupTitle = group ? (browse === 'nights' ? `Night of ${group.title}` : group.title) : null
  const position = selectedIndex < 0 ? null : `Image ${selectedIndex + 1} of ${visible.length}`

  function href(patch: Partial<BrowseSelection> = {}, nextImageId?: string) {
    const next = { ...selection, ...patch }
    const search = new URLSearchParams({ browse: next.browse })

    if (next.group) search.set('group', next.group)

    if (next.filter) search.set('filter', next.filter)

    if (next.query) search.set('q', next.query)

    return `${base}${nextImageId ? `/${encodeURIComponent(nextImageId)}` : ''}?${search}`
  }

  function requestFocus(event: MouseEvent<HTMLAnchorElement>, destination: FocusDestination) {
    if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey)
      requestedFocus.current = destination
  }

  useEffect(() => {
    const destination = requestedFocus.current

    if (!destination) return

    const element = { image: viewer.current, group: groupHeading.current, library: library.current }[destination]

    if (!element) return

    element.focus({ preventScroll: true })
    element.scrollIntoView({ block: 'nearest' })

    if (destination !== 'image' || selected.view || selected.error) requestedFocus.current = null
  }, [imageId, groupId, browse, selected.view, selected.error])

  const navigation = selectedIndex < 0 ? null : (
    <nav className="photographs__image-navigation" aria-label="Photographs in this group">
      {selectedIndex > 0 ? (
        <Link className="vela-button" to={href({}, visible[selectedIndex - 1]!.id)} onClick={event => requestFocus(event, 'image')}>← Newer</Link>
      ) : <Button disabled>← Newer</Button>}
      <span>{position}</span>
      {selectedIndex < visible.length - 1 ? (
        <Link className="vela-button" to={href({}, visible[selectedIndex + 1]!.id)} onClick={event => requestFocus(event, 'image')}>Older →</Link>
      ) : <Button disabled>Older →</Button>}
    </nav>
  )

  return (
    <article className="photographs">
      <header className="photographs__heading">
        <h1>Photographs</h1>
        {rigName && <span>{rigName}{collection.view && ` · ${images.length} photographs`}</span>}
        <p>Available even when the rig is disconnected</p>
      </header>
      <div className="photographs__content" role="region" aria-label="Photograph library" ref={library} tabIndex={-1}>
        {collection.error && (
          <div className="photographs__read-status photographs__collection-feedback" role="status">
            <p>{collection.error}</p>
            <Button onClick={collection.refresh}>Retry photographs</Button>
          </div>
        )}
        {collection.loading && images.length === 0 && (imageId
          ? <p className="photographs__collection-feedback" role="status">Loading photographs…</p>
          : <CollectionState state="loading" rigId={rigId} rigName={rigName} />)}
        {!collection.loading && collection.view && images.length === 0 && (imageId
          ? <p className="photographs__collection-feedback">No photographs in the current collection listing.</p>
          : <CollectionState state="empty" rigId={rigId} rigName={rigName} />)}
        {(groupId || imageId) && (
          <div className="photographs__back">
            <Link
              className="vela-button"
              to={href(imageId && group ? {} : { group: '', filter: '' })}
              onClick={event => requestFocus(event, imageId && group ? 'group' : 'library')}
            >← {imageId && groupTitle ? groupTitle : `All ${browse}`}</Link>
          </div>
        )}
        {group && (
          <div className="photographs__group-heading">
            <div>
              <h2 ref={groupHeading} tabIndex={-1}>{groupTitle}</h2>
              <p>{visible.length} photographs{filter ? ' matching filter' : ''} · Newest first</p>
            </div>
            {!imageId && <Select
              label={browse === 'nights' ? 'Target' : 'Observing night'}
              value={filter}
              options={[
                { value: '', label: `All ${opposite}` },
                ...filters.map(item => ({ value: item.id, label: item.title })),
              ]}
              onChange={event => { void navigate(href({ filter: event.target.value })) }}
            />}
          </div>
        )}
        {imageId ? (
          <div className="photographs__inspection">
            {image ? (
              <SelectedPhotograph
                key={pixelIdentity(image)}
                image={image}
                rigId={rigId}
                timeZone={timeZone}
                night={photographNightTitle(photographNight(image.capturedAt, timeZone))}
                position={position}
                navigation={navigation}
                viewerRef={viewer}
              />
            ) : (
              <section className="photographs__viewer photographs__pending" aria-label="Saved preview" tabIndex={-1} ref={viewer}>
                <div className="photographs__read-status" role="status">
                  {selected.loading ? <>
                    <h2>Preparing selected photograph</h2>
                    <p>Preparing the display preview from the retained original may take a moment.</p>
                  </> : <>
                    <h2>Selected photograph unavailable</h2>
                    <p>{selected.error}</p>
                    <Button onClick={selected.refresh}>Retry selected photograph</Button>
                  </>}
                </div>
              </section>
            )}
          </div>
        ) : group ? (
          <PhotographGrid images={visible} browse={browse} timeZone={timeZone} imageHref={id => href({}, id)} onOpen={event => requestFocus(event, 'image')} />
        ) : groupId && collection.view ? (
          <p role="status">This group is no longer in the photograph collection.</p>
        ) : images.length > 0 ? (
          <PhotographGroups
            groups={groups}
            browse={browse}
            query={selection.query}
            timeZone={timeZone}
            onBrowse={next => { void navigate(href({ browse: next, group: '', filter: '', query: '' })) }}
            onSearch={query => { void navigate(href({ query }), { replace: true }) }}
            groupHref={id => href({ group: id, filter: '' })}
            onOpen={event => requestFocus(event, 'group')}
          />
        ) : null}
      </div>
      <footer className="photographs__footer">
        <span>Saved images belong to this rig. Select another rig to browse its photographs.</span>
        {(collection.view || selected.view) && <span>Vela server time · {timeZone}</span>}
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
