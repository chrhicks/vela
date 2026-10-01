import type {
  TargetCatalogItem,
  TargetCatalogView,
  TargetCategory,
  TargetDiscoveryItem,
  TargetDiscoveryView,
  TargetFilterChoice,
} from '@vela/model/web'
import { Button, Input, Panel, Select } from '@vela/ui'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { AltitudeTrace } from './AltitudeTrace'
import { skyTime } from './sky-time'
import { SkyInspection } from './SkyInspection'
import { useCatalog } from './use-catalog'
import { savedDiscovery, selectionOf, useDiscovery, type DiscoverySelection } from './use-discovery'
import './target-discovery.css'

const categories: Array<[TargetCategory | 'all', string]> = [
  ['all', 'All object types'],
  ['emission', 'Emission nebulae'],
  ['reflection-dark', 'Reflection & dark'],
  ['galaxy', 'Galaxies'],
  ['cluster', 'Star clusters'],
  ['planetary', 'Planetary nebulae'],
  ['other', 'Other'],
]

const filters: Array<[TargetFilterChoice | 'all', string]> = [
  ['all', 'Imaging preference · Any filter'],
  ['dual-band', 'L-Ultimate subjects'],
  ['broadband', 'Broadband subjects'],
]

const dateTime = (at: string) =>
  new Date(at).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

const direction = (degrees: number) =>
  ['North', 'Northeast', 'East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest'][
    Math.round(degrees / 45) % 8
  ]

function extent(target: TargetCatalogItem) {
  if (target.sizeArcminutes === null) return 'Size unavailable'

  return target.minorSizeArcminutes === null
    ? `${target.sizeArcminutes}′ across`
    : `${target.sizeArcminutes}′ × ${target.minorSizeArcminutes}′`
}

function ReferenceImage({ target }: { target: TargetCatalogItem }) {
  const [failed, setFailed] = useState(false)

  return failed ? (
    <div className="vela-target-no-image">
      <strong>Reference image unavailable</strong>
      <span>{target.name}</span>
    </div>
  ) : (
    <img
      loading="lazy"
      src={target.thumbnailUrl}
      alt={`${target.name} reference survey`}
      onError={() => setFailed(true)}
      draggable={false}
    />
  )
}

function parseSelection(params: URLSearchParams, rigId?: string): DiscoverySelection {
  if (!params.size && rigId) {
    const saved = savedDiscovery(rigId)

    if (saved) return selectionOf(saved)
  }

  return {
    query: params.get('q') ?? '',
    category: categories.find(([key]) => key === params.get('category'))?.[0] ?? 'all',
    filter: filters.find(([key]) => key === params.get('filter'))?.[0] ?? 'all',
    offset: Math.max(0, Math.floor(Number(params.get('offset')) || 0)),
  }
}

export function TargetBrowser({ rigId }: { rigId: string }) {
  const [params] = useSearchParams()
  const selection = parseSelection(params, rigId)

  return <ExploreSubjects rigId={rigId} selection={selection} {...useDiscovery(rigId, selection)} />
}

export function CatalogBrowser() {
  const [params] = useSearchParams()
  const selection = parseSelection(params)

  return <ExploreSubjects selection={selection} {...useCatalog(selection)} />
}

function ExploreSubjects({
  rigId,
  selection,
  view,
  loading,
  error,
  saved,
  refresh,
}: {
  rigId?: string
  selection: DiscoverySelection
  view: TargetDiscoveryView | TargetCatalogView | null
  loading: boolean
  error: string | null
  saved: boolean
  refresh(): void
}) {
  const [params, setParams] = useSearchParams()
  const [input, setInput] = useState(selection.query)
  const resultsHeading = useRef<HTMLDivElement>(null)
  const subjectPanel = useRef<HTMLElement>(null)
  const focusSelectedSubject = useRef(false)
  const pageNavigation = useRef<DiscoverySelection | null>(null)
  const discovery = view && 'snapshotId' in view ? view : null
  const displayed = view ? selectionOf(view) : selection

  const selected =
    view?.targets.find((target) => target.id === params.get('subject')) ?? view?.targets[0]

  const sky = discovery?.targets.find((target) => target.id === selected?.id)?.sky ?? null

  const changed =
    !!view &&
    (view.query !== selection.query.trim() ||
      view.category !== selection.category ||
      view.filter !== selection.filter ||
      view.offset !== selection.offset)

  const browseParams = (next: DiscoverySelection) => {
    const values = new URLSearchParams({ category: next.category, filter: next.filter })

    if (next.query) values.set('q', next.query)

    if (next.offset) values.set('offset', String(next.offset))

    return values
  }

  const update = (patch: Partial<DiscoverySelection>) => {
    pageNavigation.current = null
    const next = browseParams({ ...selection, offset: 0, ...patch })
    const subject = params.get('subject')

    if (subject) next.set('subject', subject)
    setParams(next)
  }

  useEffect(() => {
    setInput(selection.query)
  }, [selection.query])
  useEffect(() => {
    const timer = setTimeout(() => {
      if (input !== selection.query) update({ query: input })
    }, 300)

    return () => clearTimeout(timer)
  }, [input, selection.query, selection.category, selection.filter])
  useEffect(() => {
    const requested = pageNavigation.current

    if (!requested) return

    if (
      error ||
      requested.query !== selection.query ||
      requested.category !== selection.category ||
      requested.filter !== selection.filter ||
      requested.offset !== selection.offset
    ) {
      pageNavigation.current = null

      return
    }

    if (loading || !view || changed) return
    pageNavigation.current = null
    resultsHeading.current?.scrollIntoView({ block: 'start' })
    resultsHeading.current?.focus({ preventScroll: true })
  }, [
    view,
    loading,
    error,
    changed,
    selection.query,
    selection.category,
    selection.filter,
    selection.offset,
  ])
  // A subject is presentation state on this result page, never a hardware command.
  useEffect(() => {
    if (
      !view ||
      loading ||
      changed ||
      !params.has('subject') ||
      view.targets.some((target) => target.id === params.get('subject'))
    )
      return
    const next = new URLSearchParams(params)
    next.delete('subject')
    setParams(next, { replace: true })
  }, [view, loading, changed, params, setParams])

  const showSubjectOnPhone = () => {
    if (!window.matchMedia('(max-width: 720px)').matches) return
    subjectPanel.current?.scrollIntoView({ block: 'start' })
    subjectPanel.current?.focus({ preventScroll: true })
  }

  useEffect(() => {
    if (!focusSelectedSubject.current) return
    focusSelectedSubject.current = false
    showSubjectOnPhone()
  }, [selected?.id])

  const select = (id: string) => {
    if (id === selected?.id) {
      showSubjectOnPhone()

      return
    }

    focusSelectedSubject.current = true
    const values = browseParams(displayed)
    values.set('subject', id)
    setParams(values)
  }

  const turnPage = (offset: number) => {
    const next = { ...displayed, offset }
    update(next)
    pageNavigation.current = next
  }

  const refreshFromNow = () => {
    if (selection.offset) update({ offset: 0 })
    refresh()
  }

  const frameSearch = browseParams(displayed)

  if (selected) frameSearch.set('subject', selected.id)

  const frameLink =
    rigId && selected
      ? `/rigs/${encodeURIComponent(rigId)}/observe/targets/${encodeURIComponent(selected.id)}?${frameSearch}`
      : null

  const noSite = discovery?.status === 'site-unavailable'

  return (
    <section className="vela-discovery" aria-label="Target discovery">
      <header className="vela-discovery__header">
        <h1>Explore the sky</h1>
        <div className="vela-discovery__snapshot" role="status">
          <span>
            {discovery
              ? `${discovery.rigName} · ${saved ? 'Saved suggestions' : 'Calculated'} ${dateTime(discovery.calculatedAt)}`
              : rigId
                ? error
                  ? 'Sky calculation unavailable'
                  : 'Reading observing site…'
                : 'Deep-sky catalog'}
          </span>
          <Button tone="quiet" disabled={loading} onClick={refreshFromNow}>
            {rigId ? 'Update sky' : 'Refresh catalog'}
          </Button>
        </div>
      </header>
      <div className="vela-discovery__controls">
        <div className="vela-discovery__search">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="10" cy="10" r="7" />
            <path d="m15 15 6 6" />
          </svg>
          <Input
            aria-label="Find a target"
            type="search"
            placeholder="Search a name or catalog number"
            value={input}
            onFocus={() => {
              pageNavigation.current = null
            }}
            onChange={(event) => {
              pageNavigation.current = null
              setInput(event.target.value)
            }}
          />
        </div>
        <Select
          aria-label="Object type"
          value={selection.category}
          options={categories.map(([value, label]) => ({ value, label }))}
          onChange={(event) =>
            update({
              category: categories.find(([value]) => value === event.target.value)?.[0] ?? 'all',
            })
          }
        />
        <Select
          aria-label="Imaging filter"
          value={selection.filter}
          options={filters.map(([value, label]) => ({ value, label }))}
          onChange={(event) =>
            update({
              filter: filters.find(([value]) => value === event.target.value)?.[0] ?? 'all',
            })
          }
        />
      </div>
      {error && (
        <Panel>
          <p role="alert">{error}</p>
          {changed && <p>The cards below still show your previous selection.</p>}
        </Panel>
      )}
      {discovery?.siteUnavailableReason && (
        <Panel>
          <p role="status">The mount’s site could not be read: {discovery.siteUnavailableReason}</p>
          <p>
            These are catalog suggestions, without a location-based ranking. Update sky after the
            site becomes available.
          </p>
        </Panel>
      )}
      <div className="vela-discovery__layout">
        <div>
          <div className="vela-discovery__results" role="status" ref={resultsHeading} tabIndex={-1}>
            <span>
              {view?.query
                ? `Results for “${view.query}”`
                : !rigId || noSite
                  ? 'Explore the catalog'
                  : discovery?.night?.kind === 'upcoming-night'
                    ? 'The coming night'
                    : discovery?.night?.kind === 'polar-night'
                      ? 'Polar night · next 24 hours'
                      : 'Visible tonight'}
            </span>
            <span>
              {loading
                ? 'Loading selection…'
                : view
                  ? `Showing ${view.targets.length} of ${view.total.toLocaleString()} subjects`
                  : ''}
            </span>
          </div>
          <div className="vela-discovery__grid" aria-busy={loading}>
            {view?.targets.map((target) => {
              const item: TargetDiscoveryItem | null =
                discovery?.targets.find((candidate) => candidate.id === target.id) ?? null

              return (
                <article
                  className="vela-discovery__card"
                  data-selected={selected?.id === target.id}
                  key={target.id}
                >
                  <div className="vela-discovery__image">
                    <ReferenceImage target={target} />
                  </div>
                  <div className="vela-discovery__body">
                    <h2>{target.name}</h2>
                    <p className="vela-discovery__catalog">
                      {target.catalog} · {target.kind}
                    </p>
                    <div className="vela-discovery__card-facts">
                      <span>
                        {item?.sky
                          ? `${Math.round(item.sky.currentAltitudeDegrees)}° · ${direction(item.sky.currentAzimuthDegrees)}`
                          : (target.constellation ?? 'Catalog subject')}
                      </span>
                      <span>{extent(target)}</span>
                    </div>
                    <p className="vela-discovery__window">
                      {item?.opportunity
                        ? `Above 30° until ${skyTime(item.opportunity.endsAt)}`
                        : item?.sky
                          ? 'No useful window this night'
                          : rigId
                            ? 'Observing window unavailable'
                            : 'Choose a rig for sky timing'}
                    </p>
                    <Button
                      tone="quiet"
                      aria-pressed={selected?.id === target.id}
                      onClick={() => select(target.id)}
                    >
                      {selected?.id === target.id ? (
                        <>
                          Selected · Details{' '}
                          <span className="vela-discovery__wide-location">at right</span>
                          <span className="vela-discovery__compact-location">below</span> →
                        </>
                      ) : (
                        'View subject →'
                      )}
                    </Button>
                  </div>
                </article>
              )
            })}
          </div>
          {view?.total === 0 && (
            <Panel>
              <div className="vela-target-empty">
                <h2>
                  {discovery?.status === 'no-darkness' && !view.query
                    ? 'No astronomical darkness ahead'
                    : 'No targets match these filters'}
                </h2>
                <p>
                  {discovery?.status === 'no-darkness' && !view.query
                    ? 'The Sun does not reach 18° below the horizon in the calculation window. You can still search the catalog.'
                    : 'Your search is kept. Broaden the target types or turn off the imaging filter.'}
                </p>
                <Button
                  onClick={() => {
                    update({ category: 'all', filter: 'all' })
                  }}
                >
                  Clear filters
                </Button>
              </div>
            </Panel>
          )}
        </div>
        {selected && (
          <aside
            ref={subjectPanel}
            tabIndex={-1}
            className="vela-discovery__subject"
            aria-label={`${selected.name} details`}
          >
            <p>
              {selected.name} · {sky ? 'Through the night' : 'Subject details'}
            </p>
            {sky ? (
              <>
                <div className="vela-discovery__altitude">
                  <strong>{Math.round(sky.currentAltitudeDegrees)}°</strong>
                  <span>above the horizon at {skyTime(sky.observedAt)}</span>
                </div>
                <AltitudeTrace sky={sky} stale={saved || !!error} variant="explore" />
                <dl>
                  <div>
                    <dt>Direction</dt>
                    <dd>
                      {direction(sky.currentAzimuthDegrees)} ·{' '}
                      {Math.round(sky.currentAzimuthDegrees)}°
                    </dd>
                  </div>
                  <div>
                    <dt>Moon separation</dt>
                    <dd>{Math.round(sky.currentMoonSeparationDegrees)}°</dd>
                  </div>
                </dl>
                <p>Sky estimates don’t include local obstructions or weather.</p>
              </>
            ) : (
              <>
                <h2>{selected.name}</h2>
                <dl>
                  <div>
                    <dt>Catalog</dt>
                    <dd>{selected.catalog}</dd>
                  </div>
                  <div>
                    <dt>Object type</dt>
                    <dd>{selected.kind}</dd>
                  </div>
                  <div>
                    <dt>Constellation</dt>
                    <dd>{selected.constellation ?? 'Unavailable'}</dd>
                  </div>
                  <div>
                    <dt>Apparent size</dt>
                    <dd>{extent(selected)}</dd>
                  </div>
                  <div>
                    <dt>Distance</dt>
                    <dd>Unavailable</dd>
                  </div>
                </dl>
                <p>
                  {rigId
                    ? 'Sky timing is unavailable until the observing site can be read.'
                    : 'Sky timing requires a rig and its observing site.'}
                </p>
              </>
            )}
            {frameLink ? (
              <Link className="vela-button" data-tone="accent" to={frameLink}>
                Frame this subject →
              </Link>
            ) : (
              <Link className="vela-button" data-tone="accent" to="/">
                Add or choose a rig →
              </Link>
            )}
          </aside>
        )}
      </div>
      <footer className="vela-discovery__footer">
        <span>Reference survey · DSS2 / CDS</span>
        {view && view.total > 0 && (
          <nav aria-label="Target pages">
            <span>
              Page {Math.floor(view.offset / view.pageSize) + 1} of{' '}
              {Math.ceil(view.total / view.pageSize)}
            </span>
            {view.offset > 0 && (
              <Button
                tone="quiet"
                disabled={loading || view.offset === 0}
                onClick={() => turnPage(Math.max(0, view.offset - view.pageSize))}
              >
                Previous
              </Button>
            )}
            <Button
              disabled={loading || view.offset + view.pageSize >= view.total}
              onClick={() => turnPage(view.offset + view.pageSize)}
            >
              Next subjects →
            </Button>
          </nav>
        )}
      </footer>
      {selected && (
        <details className="vela-discovery__subject-details">
          <summary>Subject facts & imaging advice</summary>
          <p>
            {selected.catalog} · {selected.kind} ·{' '}
            {selected.constellation ?? 'Constellation unavailable'} · {extent(selected)}
          </p>
          <p>Distance unavailable.</p>
          <p>{selected.filterReason}</p>
          <p>Filter advice is for imaging. Installation is not detected.</p>
          {sky && <SkyInspection sky={sky} targetName={selected.name} stale={saved || !!error} />}
        </details>
      )}
      <details className="vela-discovery__method">
        <summary>How these suggestions work & credits</summary>
        <p>
          {rigId
            ? 'Ranked for photographic interest, balanced against remaining time above 30° during astronomical darkness (Sun below −18°). Search includes catalog objects without a useful window. Update sky recalculates from now; the list stays steady while you browse.'
            : 'Catalog subjects are ranked for photographic interest using object type, apparent size and familiar showpieces. No observing site or sky timing is inferred.'}
        </p>
        <p>
          Rankings do not predict weather, Moon interference, local obstructions, or how a subject
          fits your camera. Filter advice does not detect installed filters.
        </p>
        {discovery?.night && (
          <p>
            Calculation window: {dateTime(discovery.night.startsAt)} to{' '}
            {dateTime(discovery.night.endsAt)}. Times use this browser’s timezone.
          </p>
        )}
        <p>
          Reference imagery: DSS2 color / CDS.{' '}
          <a
            href="https://archive.stsci.edu/dss/acknowledging.html"
            target="_blank"
            rel="noreferrer"
          >
            Survey credits ↗
          </a>
        </p>
        <p>
          Catalog adapted from{' '}
          <a
            href="https://github.com/mattiaverga/OpenNGC/tree/da90466031b0372c896588b85be6016c617e205b"
            target="_blank"
            rel="noreferrer"
          >
            OpenNGC
          </a>{' '}
          by Mattia Verga and <a href="/third-party/openngc-authors.txt">contributors</a> ·{' '}
          <a href="/third-party/openngc-license.txt">CC BY-SA 4.0</a>.
        </p>
      </details>
    </section>
  )
}
