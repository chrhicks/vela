import type { MouseEvent } from 'react'
import { Input, Tabs } from '@vela/ui'
import { featureCatalog, catalogErrors } from './catalog'
import { ArrowIcon, SearchIcon } from './Icons'
import type { WorkshopFeature } from './definitions'
import './shelf.css'

export function FeatureShelf({ navigate, search, onSearchChange, collection, onCollectionChange }: {
  navigate: (href: string) => void
  search: string
  onSearchChange: (search: string) => void
  collection: WorkshopFeature['collection']
  onCollectionChange: (collection: WorkshopFeature['collection']) => void
}) {
  function open(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(event.currentTarget.getAttribute('href') ?? '/')
  }

  function renderCollection(collection: WorkshopFeature['collection']) {
    const query = search.trim().toLowerCase()

    const features = featureCatalog.filter(feature => (
      feature.collection === collection &&
      `${feature.label} ${feature.description}`.toLowerCase().includes(query)
    ))

    if (!features.length) {
      return (
        <div className="feature-shelf-empty" role="status">
          <h2>{query ? 'No matching features' : collection === 'past' ? 'No past explorations yet' : 'No current explorations'}</h2>
          <p>{query ? 'Try another name or clear your search.' : collection === 'past' ? 'Finished and set-aside explorations will be available here.' : 'New feature explorations will appear here when they are ready to try.'}</p>
        </div>
      )
    }

    return (
      <div className="feature-shelf-grid">
        {features.map(feature => (
          <article className="feature-shelf-card" key={feature.id}>
            <img src={feature.thumbnail.src} alt={feature.thumbnail.alt} loading="lazy" />
            <div className="feature-shelf-card-body">
              <h2>{feature.label}</h2>
              <p>{feature.description}</p>
              <a href={`/features/${feature.id}`} onClick={open} aria-label={`Open ${feature.label}`}>
                <span>Open feature</span><ArrowIcon />
              </a>
            </div>
          </article>
        ))}
      </div>
    )
  }

  return (
    <div className="feature-shelf">
      <header className="feature-shelf-header">
        <a href="/" onClick={open} className="feature-shelf-brand" aria-label="Vela Workshop home">
          <strong>Vela</strong><span>Workshop</span>
        </a>
        <a className="feature-shelf-design-system" href="/design-system" onClick={open}>
          Design system<ArrowIcon />
        </a>
      </header>

      <main className="feature-shelf-main">
        <div className="feature-shelf-intro">
          <h1>Features</h1>
          <p>A place to explore how Vela looks, feels, and works.</p>
        </div>

        {catalogErrors.length > 0 ? (
          <section className="feature-shelf-errors" aria-labelledby="feature-catalog-errors">
            <h2 id="feature-catalog-errors">The feature catalog needs attention</h2>
            <p>Fix these declarations to load the feature shelf.</p>
            <ul>
              {catalogErrors.map((error, index) => (
                <li key={`${error.source}:${error.path}:${index}`}>
                  <code>{error.source}</code>
                  <span><code>{error.path}</code>: {error.message}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <div className="feature-shelf-browser">
            <div className="feature-shelf-search">
              <SearchIcon />
              <Input
                type="search"
                aria-label="Find a feature"
                placeholder="Find a feature…"
                value={search}
                onChange={event => onSearchChange(event.target.value)}
              />
            </div>
            <Tabs
              className="feature-shelf-tabs"
              aria-label="Feature collections"
              value={collection}
              onValueChange={value => onCollectionChange(value === 'past' ? 'past' : 'current')}
              items={[
                { id: 'current', label: 'Current', content: renderCollection('current') },
                { id: 'past', label: 'Past explorations', content: renderCollection('past') },
              ]}
            />
          </div>
        )}
      </main>
    </div>
  )
}
