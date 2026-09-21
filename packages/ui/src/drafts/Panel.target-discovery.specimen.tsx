import { useState } from 'react'
import { Button, Input } from '../components'
import type { ComponentSpecimen } from '../themes'
import { targets } from './target-framing/fixtures'
import './Panel.target-discovery.specimen.css'

type Props = Record<string, string | number | boolean>

const suggestions = [
  {
    ...targets[1]!,
    family: 'Emission',
    window: '4h 20m remaining',
    altitude: '72° now · near its highest',
    reason: 'High now, with a long stretch of useful sky ahead.',
    filter: 'L-Ultimate suits this emission nebula',
    detail: 'Its Hα and O III light passes through your dual-band filter.'
  },
  {
    ...targets[2]!,
    family: 'Galaxies',
    window: '5h 10m remaining',
    altitude: '48° now · rising',
    reason: 'Climbing into clearer sky for the rest of the night.',
    filter: 'Broadband is the better fit',
    detail: 'L-Ultimate blocks much of this galaxy’s starlight.'
  },
  {
    ...targets[0]!,
    family: 'Clusters',
    window: '1h 15m remaining',
    altitude: '39° now · setting',
    reason: 'A shorter opportunity: start soon to catch it higher.',
    filter: 'Broadband is the better fit',
    detail: 'A cluster’s stars emit across the visible spectrum.'
  },
]

function Discovery({ props, onPropsChange }: { props: Props; onPropsChange?: (patch: Props) => void }) {
  function suggestionStatus() {
    switch (values.state) {
      case 'cached':
        return 'Saved suggestions · updated 21:40'
      case 'fresh':
        return 'Suggestions refreshed · updated 22:00'
      default:
        return 'Updating tonight’s suggestions…'
    }
  }

  const [local, setLocal] = useState(props)
  const values = onPropsChange ? props : local
  const update = (patch: Props) => onPropsChange ? onPropsChange(patch) : setLocal(current => ({ ...current, ...patch }))
  const filter = String(values.filter)
  const query = String(values.query ?? '').toLowerCase()
  const light = String(values.light ?? 'All light')

  const matches = suggestions.filter(target => (filter === 'All objects' || target.family === filter)
    && `${target.name} ${target.catalog}`.toLowerCase().includes(query)
    && (light === 'All light' || (light === 'L-Ultimate subjects' ? target.family === 'Emission' : target.family !== 'Emission')))

  const page = Math.min(Number(values.page) || 0, Math.max(0, Math.ceil(matches.length / 2) - 1))
  const shown = matches.slice(page * 2, page * 2 + 2)
  const refreshing = values.state === 'refreshing'

  return (
    <section className="vela-discovery-demo" aria-label="Target discovery">
      <header className="vela-discovery-demo__header">
        <div>
          <p className="vela-discovery-demo__eyebrow">Explore tonight</p>
          <h1>Find your next subject</h1>
          <p>Good opportunities from now until dawn.</p>
        </div>
        <Button size="small" tone="quiet" disabled={refreshing} onClick={() => update({ state: 'fresh', page: 0 })}>{refreshing ? 'Refreshing…' : 'Refresh'}</Button>
      </header>
      <div className="vela-discovery-demo__snapshot">
        <span>{suggestionStatus()}</span>
        <span>Sample night · illustrative ranking</span>
      </div>
      <div className="vela-discovery-demo__search">
        <Input
          aria-label="Search targets"
          placeholder="Search by name or catalog number"
          value={String(values.query ?? '')}
          onChange={event => update({ query: event.target.value, page: 0 })}
        />
        <label>
          Light preference
          <select value={light} onChange={event => update({ light: event.target.value, page: 0 })}>{['All light', 'L-Ultimate subjects', 'Broadband subjects'].map(option => <option key={option}>{option}</option>)}</select>
        </label>
      </div>
      <nav className="vela-discovery-demo__filters" aria-label="Object type">
        {['All objects', 'Emission', 'Reflection & dark', 'Galaxies', 'Clusters', 'Planetary'].map(kind => (
          <button
            key={kind}
            type="button"
            aria-pressed={filter === kind}
            onClick={() => update({ filter: kind, page: 0 })}
          >
            {kind}
          </button>
        ))}
      </nav>
      <p className="vela-discovery-demo__filter-note">
        Your filter:
        {' '}
        <strong>Optolong L-Ultimate · dual 3nm Hα / O III</strong>
        <span>Advice assumes you choose to fit it.</span>
      </p>
      <div className="vela-discovery-demo__grid" aria-busy={refreshing}>
        {shown.map((target, offset) => (
          <article className="vela-discovery-demo__card" key={target.id}>
            <div className="vela-discovery-demo__image">
              <img src={target.image} alt={`${target.name} reference photograph`} />
              <span>{target.kind}</span>
            </div>
            <div className="vela-discovery-demo__body">
              <p className="vela-discovery-demo__catalog">
                <span className="vela-discovery-demo__rank">{page * 2 + offset + 1}</span>
                {target.catalog}
              </p>
              <h2>{target.name}</h2>
              <div className="vela-discovery-demo__window">
                <strong>{target.window}</strong>
                <span>{target.altitude}</span>
              </div>
              <p className="vela-discovery-demo__reason">{target.reason}</p>
              <div className="vela-discovery-demo__advice">
                <strong>{target.filter}</strong>
                <p>{target.detail}</p>
              </div>
              <Button tone="quiet" onClick={() => update({ selected: target.name })}>
                Explore target
                {' '}
                <span aria-hidden="true">→</span>
              </Button>
              <small>
                Reference image ·
                {' '}
                <a href={target.source} target="_blank" rel="noreferrer">{target.credit}</a>
              </small>
            </div>
          </article>
        ))}
      </div>
      {matches.length === 0 && <p className="vela-discovery-demo__empty">No sample suggestions match these filters. Try another object type or light preference.</p>}
      <footer className="vela-discovery-demo__footer">
        <span>{matches.length ? page * 2 + 1 : 0}–{Math.min(page * 2 + 2, matches.length)} of {matches.length} suggestions</span>
        <div>
          <Button size="small" tone="quiet" disabled={page === 0} onClick={() => update({ page: page - 1 })}>Previous</Button>
          <Button
            size="small"
            tone="quiet"
            disabled={(page + 1) * 2 >= matches.length}
            onClick={() => update({ page: page + 1 })}
          >
            Next
          </Button>
        </div>
      </footer>
      {Boolean(values.selected) && <p className="vela-discovery-demo__selection" role="status">{String(values.selected)} selected · the app opens its framing view here.</p>}
    </section>
  )
}

export const specimen: ComponentSpecimen = {
  componentId: 'panel',
  componentName: 'Panel / Card',
  id: 'panel-target-discovery',
  name: 'Target discovery · Product example',
  description: 'Photographic suggestions for the remaining night, explicit refresh, stable pages and filter advice. Sample ranking; no live observing calculation.',
  controls: {
    filter: {
      type: 'select',
      label: 'Object type',
      options: ['All objects', 'Emission', 'Reflection & dark', 'Galaxies', 'Clusters', 'Planetary']
    },
    query: { type: 'text', label: 'Search targets' },
    light: {
      type: 'select',
      label: 'Light preference',
      options: ['All light', 'L-Ultimate subjects', 'Broadband subjects']
    },
    state: { type: 'select', label: 'Suggestions', options: ['cached', 'refreshing', 'fresh'] },
    page: { type: 'text', label: 'Page (zero based)' },
    selected: { type: 'text', label: 'Selected target' },
  },
  defaultProps: {
    filter: 'All objects',
    query: '',
    light: 'All light',
    state: 'cached',
    page: 0,
    selected: ''
  },
  render: (props, onPropsChange) => <Discovery props={props} {...(onPropsChange ? { onPropsChange } : {})} />,
}
