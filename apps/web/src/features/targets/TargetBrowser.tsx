import type { TargetCategory, TargetDiscoveryItem, TargetFilterChoice } from '@vela/model/web'
import { Button, Input, Panel } from '@vela/ui'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { savedDiscovery, selectionOf, useDiscovery, type DiscoverySelection } from './use-discovery'
import './target-discovery.css'

const categories: Array<[TargetCategory | 'all', string]> = [
  ['all', 'All objects'], ['emission', 'Emission nebulae'], ['reflection-dark', 'Reflection & dark'],
  ['galaxy', 'Galaxies'], ['cluster', 'Star clusters'], ['planetary', 'Planetary nebulae'], ['other', 'Other'],
]

const filters: Array<[TargetFilterChoice | 'all', string]> = [['all', 'All light'], ['dual-band', 'L-Ultimate subjects'], ['broadband', 'Broadband subjects']]

const clock = (at: string) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

const dateTime = (at: string) => new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

function duration(minutes: number) {
  const rounded = Math.max(1, Math.round(minutes))

  return rounded >= 60 ? `${Math.floor(rounded / 60)}h${rounded % 60 ? ` ${rounded % 60}m` : ''}` : `${rounded}m`
}

function ReferenceImage({ target }: { target: TargetDiscoveryItem }) {
  const [failed, setFailed] = useState(false)

  return failed ? <div className="vela-target-no-image"><span aria-hidden="true">◇</span><strong>Reference image unavailable</strong><span>{target.name}</span></div>
    : <img loading="lazy" src={target.thumbnailUrl} alt={`${target.name} reference survey`} onError={() => setFailed(true)} draggable={false} />
}

function parseSelection(params: URLSearchParams, rigId: string): DiscoverySelection {
  if (!params.size) {
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
  const [params, setParams] = useSearchParams()
  const selection = parseSelection(params, rigId)
  const [input, setInput] = useState(selection.query)
  const { view, loading, error, saved, refresh } = useDiscovery(rigId, selection)
  const resultsHeading = useRef<HTMLDivElement>(null)
  const pageNavigation = useRef<DiscoverySelection | null>(null)
  useEffect(() => {
    const requested = pageNavigation.current

    if (!requested) return

    if (error || requested.query !== selection.query || requested.category !== selection.category || requested.filter !== selection.filter || requested.offset !== selection.offset) {
      pageNavigation.current = null

      return
    }

    if (loading || !view || view.query !== requested.query.trim() || view.category !== requested.category || view.filter !== requested.filter || view.offset !== requested.offset) return
    pageNavigation.current = null
    resultsHeading.current?.scrollIntoView({ block: 'start' })
    resultsHeading.current?.focus({ preventScroll: true })
  }, [view, loading, error, selection.query, selection.category, selection.filter, selection.offset])

  const update = (patch: Partial<DiscoverySelection>) => {
    pageNavigation.current = null
    const next = { ...selection, offset: 0, ...patch }
    const values = new URLSearchParams({ category: next.category, filter: next.filter })

    if (next.query) values.set('q', next.query)

    if (next.offset) values.set('offset', String(next.offset))
    setParams(values)
  }

  useEffect(() => { setInput(selection.query) }, [selection.query])
  useEffect(() => {
    const timer = setTimeout(() => {
      if (input !== selection.query) update({ query: input })
    }, 300)

    return () => clearTimeout(timer)
  }, [input, selection.query, selection.category, selection.filter])
  const displayed = view ? selectionOf(view) : selection
  const changed = !!view && (view.query !== selection.query.trim() || view.category !== selection.category || view.filter !== selection.filter || view.offset !== selection.offset)
  const pending = loading

  const refreshFromNow = () => {
    if (selection.offset) update({ offset: 0 })
    refresh()
  }

  const turnPage = (offset: number) => {
    const next = { ...displayed, offset }
    update(next)
    pageNavigation.current = next
  }

  const noSite = view?.status === 'site-unavailable'
  const search = view?.query

  return <section className="vela-discovery" aria-label="Target discovery">
    <header className="vela-discovery__header"><div><p className="vela-discovery__eyebrow">{view?.rigName ?? 'Observe'} / Targets</p><h1>Find your next subject</h1><p>{search ? 'Search the deep-sky catalog, with tonight’s context.' : noSite ? 'Explore the catalog while the observing site is unavailable.' : 'Explore the night from your observing site.'}</p></div><Button tone="quiet" disabled={loading} onClick={refreshFromNow}>{loading ? 'Loading…' : 'Refresh'}</Button></header>
    <div className="vela-discovery__snapshot" role="status"><span>{view ? `${saved ? 'Saved suggestions' : 'Calculated'} · ${dateTime(view.calculatedAt)}` : error ? 'Suggestions unavailable' : 'Finding tonight’s subjects…'}</span><span>{view?.site ? `${Math.abs(view.site.latitudeDegrees).toFixed(2)}° ${view.site.latitudeDegrees < 0 ? 'S' : 'N'} · ${Math.abs(view.site.longitudeDegrees).toFixed(2)}° ${view.site.longitudeDegrees < 0 ? 'W' : 'E'}` : view ? 'Site unavailable' : 'Reading observing site'}</span></div>
    <Input label="Find a target" type="search" placeholder="Name, catalog number, or object type" value={input} onFocus={() => { pageNavigation.current = null }} onChange={event => {
      pageNavigation.current = null
      setInput(event.target.value)
    }} />
    <nav className="vela-discovery__filters" aria-label="Object type">{categories.map(([key, label]) => <button key={key} type="button" aria-pressed={selection.category === key} onClick={() => update({ category: key })}>{label}</button>)}</nav>
    <nav className="vela-discovery__filters vela-discovery__light" aria-label="Imaging filter">{filters.map(([key, label]) => <button key={key} type="button" aria-pressed={selection.filter === key} onClick={() => update({ filter: key })}>{label}</button>)}</nav>
    <p className="vela-discovery__filter-note">Your filter: <strong>Optolong L-Ultimate · dual 3nm Hα / O III</strong><span>Filter advice is for imaging. Installation is not detected.</span></p>
    {error && <Panel><p role="alert">{error}</p>{changed && <p>The cards below still show your previous selection.</p>}</Panel>}
    {view?.siteUnavailableReason && <Panel><p role="status">The mount’s site could not be read: {view.siteUnavailableReason}</p><p>These are catalog suggestions, without a location-based ranking. Refresh after the site becomes available.</p></Panel>}
    <div className="vela-discovery__results" role="status" ref={resultsHeading} tabIndex={-1}><strong>{search ? `Results for “${search}”` : noSite ? 'Explore the catalog' : view?.night?.kind === 'upcoming-night' ? 'The coming night' : 'Explore tonight'}</strong><span>{pending ? 'Loading selection…' : view ? `${view.total.toLocaleString()} ${search ? 'matches' : 'subjects'}` : ''}</span></div>
    <div className="vela-discovery__grid" aria-busy={loading}>{view?.targets.map((target, index) => {
      const opportunity = target.opportunity
      const linkParams = new URLSearchParams({ category: displayed.category, filter: displayed.filter, offset: String(displayed.offset) })

      if (displayed.query) linkParams.set('q', displayed.query)

      return <article className="vela-discovery__card" key={target.id}>
        <Link className="vela-discovery__image" tabIndex={-1} aria-hidden="true" to={{ pathname: `/rigs/${encodeURIComponent(rigId)}/observe/targets/${encodeURIComponent(target.id)}`, search: linkParams.toString() }}><ReferenceImage target={target} /><span>{target.kind}</span></Link>
        <div className="vela-discovery__body"><p className="vela-discovery__catalog"><span>{target.catalog}{target.sizeArcminutes !== null ? ` · ${target.sizeArcminutes}′ across` : ''}</span>{!noSite && !search && <span>#{view.offset + index + 1}</span>}</p><h2>{target.name}</h2>
          <div className="vela-discovery__window"><strong>{opportunity ? `${duration(opportunity.usefulMinutes)} of useful dark sky` : noSite ? 'Observing window unavailable' : 'No useful window this night'}</strong><span>{opportunity ? `${clock(opportunity.startsAt)} – ${clock(opportunity.endsAt)} · above 30°` : 'Explore the target to inspect its sky path.'}</span></div>
          <p className="vela-discovery__reason">{opportunity ? `Best remaining altitude ${Math.round(opportunity.bestAltitudeDegrees)}° at ${clock(opportunity.bestAt)}. ${Math.round(opportunity.currentAltitudeDegrees)}° at calculation time.` : target.sky ? 'Below the useful altitude during remaining darkness.' : 'Refresh with an available observing site for tonight’s context.'}</p>
          <div className="vela-discovery__advice"><strong>{{ 'dual-band': 'L-Ultimate suits this subject', broadband: 'Broadband is the better fit', uncertain: 'Start with broadband' }[target.filterChoice]}</strong><p>{target.filterReason}</p></div>
          <Link className="vela-button vela-button--quiet" to={{ pathname: `/rigs/${encodeURIComponent(rigId)}/observe/targets/${encodeURIComponent(target.id)}`, search: linkParams.toString() }}>Explore target <span aria-hidden="true">→</span></Link>
          <small>Reference survey · DSS2 / CDS</small>
        </div>
      </article>
    })}</div>
    {view?.total === 0 && <Panel><div className="vela-target-empty"><h2>{view.status === 'no-darkness' && !view.query ? 'No astronomical darkness ahead' : 'No matching subjects'}</h2><p>{view.status === 'no-darkness' && !view.query ? 'The Sun does not reach 18° below the horizon in the calculation window. You can still search the catalog.' : 'Try another object type, imaging filter, or catalog search.'}</p><Button onClick={() => { setInput(''); update({ query: '', category: 'all', filter: 'all' }) }}>Clear filters</Button></div></Panel>}
    {view && view.total > 0 && <nav className="vela-discovery__footer" aria-label="Target pages"><span>{view.offset + 1}–{Math.min(view.offset + view.pageSize, view.total)} of {view.total.toLocaleString()}</span><div><Button tone="quiet" disabled={loading || view.offset === 0} onClick={() => turnPage(Math.max(0, view.offset - view.pageSize))}>Previous</Button><Button tone="quiet" disabled={loading || view.offset + view.pageSize >= view.total} onClick={() => turnPage(view.offset + view.pageSize)}>Next</Button></div></nav>}
    <details className="vela-discovery__method"><summary>How these suggestions work</summary><p>Ranked for photographic interest using object type, apparent size and familiar showpieces, balanced against remaining time above 30° during astronomical darkness (Sun below −18°). These approximate windows start at the calculation time or later. Refresh recalculates from now; the list stays steady while you browse.</p><p>Search includes catalog objects even without a useful window. Rankings do not predict weather, Moon interference, local obstructions, or how a subject fits your camera. Check the sky path and framing before choosing.</p>{view?.night && <p>Calculation window: {dateTime(view.night.startsAt)} to {dateTime(view.night.endsAt)}{view.night.kind === 'polar-night' ? ' · polar night, limited to 24 hours' : ''}. Times use this browser’s timezone.</p>}</details>
    <p className="vela-target-footnote">Reference imagery: DSS2 color / CDS. <a href="https://archive.stsci.edu/dss/acknowledging.html" target="_blank" rel="noreferrer">Survey credits ↗</a></p>
    <p className="vela-target-footnote">Catalog adapted from <a href="https://github.com/mattiaverga/OpenNGC/tree/da90466031b0372c896588b85be6016c617e205b" target="_blank" rel="noreferrer">OpenNGC</a> by Mattia Verga and <a href="/third-party/openngc-authors.txt" target="_blank" rel="noreferrer">contributors</a> · <a href="/third-party/openngc-license.txt" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>.</p>
  </section>
}
