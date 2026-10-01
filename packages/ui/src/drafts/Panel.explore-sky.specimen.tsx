import { useRef, useState } from 'react'
import { Button, Dialog, IconButton, Input, NavigationBar, Panel, Select, SkyPath } from '../components'
import type { SkyLightPhase } from '../components'
import type { ComponentSpecimen } from '../themes'
import targets from './explore-sky/fixtures.json'
import './Panel.explore-sky.specimen.css'

type Props = Record<string, string | number | boolean>

type Target = typeof targets[number]

type Sky = Target['sky']

const images = new Map(Object.entries({
  ngc1499: new URL('./explore-sky/ngc1499.jpg', import.meta.url).href,
  ngc7000: new URL('./explore-sky/ngc7000.jpg', import.meta.url).href,
  ic1396: new URL('./explore-sky/ic1396.jpg', import.meta.url).href,
  ic1805: new URL('./explore-sky/ic1805.jpg', import.meta.url).href,
  ic1848: new URL('./explore-sky/ic1848.jpg', import.meta.url).href,
  ngc6888: new URL('./explore-sky/ngc6888.jpg', import.meta.url).href,
  ngc6960: new URL('./explore-sky/ngc6960.jpg', import.meta.url).href,
  ngc6992: new URL('./explore-sky/ngc6992.jpg', import.meta.url).href,
  ngc7635: new URL('./explore-sky/ngc7635.jpg', import.meta.url).href,
}))

const categories = [
  { value: 'all', label: 'All object types' },
  { value: 'emission', label: 'Emission nebulae' },
  { value: 'reflection-dark', label: 'Reflection & dark' },
  { value: 'galaxy', label: 'Galaxies' },
  { value: 'cluster', label: 'Star clusters' },
  { value: 'planetary', label: 'Planetary nebulae' },
  { value: 'other', label: 'Other' },
]

const filters = [
  { value: 'all', label: 'Imaging preference · Any filter' },
  { value: 'dual-band', label: 'L-Ultimate subjects' },
  { value: 'broadband', label: 'Broadband subjects' },
]

const time = (at: string) => new Date(at).toLocaleTimeString('en-GB', {
  timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
})

const direction = (degrees: number) =>
  ['North', 'Northeast', 'East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest'][
    Math.round(degrees / 45) % 8
  ]

function lightPhase(altitude: number): SkyLightPhase {
  if (altitude <= -18) return 'night'

  if (altitude <= -12) return 'astronomical'

  if (altitude <= -6) return 'nautical'

  return altitude < 0 ? 'civil' : 'daylight'
}

function nearestSample(sky: Sky) {
  const start = Date.parse(sky.startsAt)
  const interval = (Date.parse(sky.endsAt) - start) / (sky.samples.length - 1)

  return Math.max(0, Math.min(sky.samples.length - 1,
    Math.round((Date.parse(sky.observedAt) - start) / interval)))
}

function extent(target: Target) {
  return target.minorSizeArcminutes === null
    ? `${target.sizeArcminutes}′ across`
    : `${target.sizeArcminutes}′ × ${target.minorSizeArcminutes}′`
}

function SkyPathIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 19h18M4 15a8 8 0 0 1 10-9" />
      <path d="m17 3 1.1 2.9L21 7l-2.9 1.1L17 11l-1.1-2.9L13 7l2.9-1.1Z" />
      <path d="M20 13v2" />
      <circle cx="4" cy="15" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

function AltitudeTrace({ sky }: { sky: Sky }) {
  const start = Date.parse(sky.startsAt)
  const duration = Date.parse(sky.endsAt) - start
  const x = (at: string) => 35 + ((Date.parse(at) - start) / duration) * 335
  const y = (altitude: number) => 160 - (Math.max(0, altitude) / 90) * 130
  const nowX = x(sky.observedAt)
  const nowY = y(sky.currentAltitudeDegrees)

  return (
    <svg className="vela-explore-sky__trace" viewBox="0 0 382 196" role="img"
      aria-label={`Altitude from ${time(sky.startsAt)} to ${time(sky.endsAt)}. Snapshot altitude ${Math.round(sky.currentAltitudeDegrees)} degrees.`}>
      <path d="M35 25V160H370" className="vela-explore-sky__axis" />
      {[90, 60, 30].map(altitude => (
        <g key={altitude}>
          <path d={`M35 ${y(altitude)}H370`} className="vela-explore-sky__axis" />
          <text x="0" y={y(altitude) + 4}>{altitude}°</text>
        </g>
      ))}
      <polyline points={sky.samples.map(sample => `${x(sample.at)},${y(sample.altitudeDegrees)}`).join(' ')} className="vela-explore-sky__future" />
      <path d={`M${nowX} 30V160`} className="vela-explore-sky__future" />
      <circle cx={nowX} cy={nowY} r="6" />
      <text x="28" y="185">{time(sky.startsAt)}</text>
      {nowX > 82 && nowX < 321 && <text x={nowX} y="185" textAnchor="middle">{time(sky.observedAt)}</text>}
      <text x="370" y="185" textAnchor="end">{time(sky.endsAt)}</text>
    </svg>
  )
}

function ExploreSky({ props, onPropsChange }: {
  props: Props
  onPropsChange?: (patch: Props) => void
}) {
  const [local, setLocal] = useState(props)
  const values = onPropsChange ? props : local
  const subjectPanel = useRef<HTMLElement>(null)

  const update = (patch: Props) => onPropsChange
    ? onPropsChange(patch)
    : setLocal(current => ({ ...current, ...patch }))

  const matches = targets.filter(target =>
    `${target.name} ${target.catalog}`.toLowerCase().includes(String(values.query).toLowerCase()) &&
    (values.category === 'all' || target.category === values.category) &&
    (values.filter === 'all' || target.filterChoice === values.filter),
  )

  const selected = matches.find(target => target.id === values.target) ?? matches[0]
  const sky = selected?.sky

  const selectedIndex = sky
    ? Math.max(0, Math.min(sky.samples.length - 1, Number(values.skyIndex)))
    : 0

  return (
    <article className="vela-explore-sky">
      <NavigationBar
        home={{ href: '#', onClick: event => event.preventDefault() }}
        rigs={[{ id: 'askar', name: 'Askar FRA 400' }]}
        currentRigId="askar" onRigChange={() => {}}
        links={['Tonight', 'Explore the sky', 'Photographs'].map(label => ({
          label, href: `#${label.toLowerCase().replaceAll(' ', '-')}`,
          current: label === 'Explore the sky',
          onClick: event => event.preventDefault(),
        }))}
        utility={<span>Connected</span>}
      />
      <main className="vela-explore-sky__main">
        <header className="vela-explore-sky__header">
          <h1>Explore the sky</h1>
          <div className="vela-explore-sky__snapshot">
            <span>Askar FRA 400 · Snapshot Oct 1, 18:19</span>
            <Button tone="quiet" onClick={() => update({ notice: 'Workshop snapshot: sky data is fixed for this design review.' })}>Update sky</Button>
          </div>
        </header>
        <div className="vela-explore-sky__controls">
          <div className="vela-explore-sky__search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="m15 15 6 6" /></svg>
            <Input aria-label="Find a target" type="search" placeholder="Search a name or catalog number"
              value={String(values.query)} onChange={event => update({ query: event.target.value })} />
          </div>
          <Select aria-label="Object type" value={String(values.category)} options={categories}
            onChange={event => update({ category: event.target.value })} />
          <Select aria-label="Imaging filter" value={String(values.filter)} options={filters}
            onChange={event => update({ filter: event.target.value })} />
        </div>
        <div className="vela-explore-sky__layout">
          <div>
            <div className="vela-explore-sky__results" role="status">
              <span>{values.query ? `Results for “${values.query}”` : 'The coming night'}</span>
              <span>Showing {matches.length} of 9 sample subjects</span>
            </div>
            <div className="vela-explore-sky__grid">
              {matches.map(target => (
                <article className="vela-explore-sky__card" data-selected={selected?.id === target.id} key={target.id}>
                  <div className="vela-explore-sky__image"><img src={images.get(target.id)} alt={`${target.name} reference survey`} /></div>
                  <div className="vela-explore-sky__body">
                    <h2>{target.name}</h2>
                    <p className="vela-explore-sky__catalog">{target.catalog} · {target.kind}</p>
                    <div className="vela-explore-sky__card-facts">
                      <span>{Math.round(target.sky.currentAltitudeDegrees)}° · {direction(target.sky.currentAzimuthDegrees)}</span>
                      <span>{extent(target)}</span>
                    </div>
                    <p className="vela-explore-sky__window">Above 30° from {time(target.opportunity.startsAt)} to {time(target.opportunity.endsAt)}</p>
                    <Button tone="quiet" aria-pressed={selected?.id === target.id} onClick={() => {
                      update({ target: target.id, skyIndex: nearestSample(target.sky), notice: '' })

                      const width = subjectPanel.current?.closest('.vela-explore-sky')?.clientWidth

                      if (width !== undefined && width <= 720) {
                        requestAnimationFrame(() => {
                          subjectPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                          subjectPanel.current?.focus({ preventScroll: true })
                        })
                      }
                    }}>
                      {selected?.id === target.id ? <>
                        Selected · Details <span className="vela-explore-sky__wide-location">at right</span><span className="vela-explore-sky__compact-location">below</span> →
                      </> : 'View subject →'}
                    </Button>
                  </div>
                </article>
              ))}
            </div>
            {!matches.length && <Panel title="No targets match these filters">
              <p>This workshop snapshot contains nine emission nebulae.</p>
              <Button onClick={() => update({ category: 'all', filter: 'all', query: '' })}>Clear filters</Button>
            </Panel>}
          </div>
          {selected && sky && (
            <aside ref={subjectPanel} tabIndex={-1} className="vela-explore-sky__subject" aria-label={`${selected.name} details`}>
              <div className="vela-explore-sky__subject-heading">
                <p>{selected.name} · Through the night</p>
                <IconButton label="View sky path" icon={<SkyPathIcon />} onClick={() => update({ skyOpen: true })} />
              </div>
              <div className="vela-explore-sky__altitude">
                <strong>{Math.round(Math.abs(sky.currentAltitudeDegrees))}°</strong>
                <span>{sky.currentAltitudeDegrees < 0 ? 'below' : 'above'} the horizon at {time(sky.observedAt)}</span>
              </div>
              <AltitudeTrace sky={sky} />
              <dl>
                <div><dt>Direction</dt><dd>{direction(sky.currentAzimuthDegrees)} · {Math.round(sky.currentAzimuthDegrees)}°</dd></div>
                <div><dt>Moon separation</dt><dd>{Math.round(sky.currentMoonSeparationDegrees)}°</dd></div>
              </dl>
              <p>Sky estimates don’t include local obstructions or weather.</p>
              <Button tone="accent" onClick={() => update({ notice: 'Framing navigation is not shown in this Explore workshop proposal.' })}>Frame this subject →</Button>
            </aside>
          )}
        </div>
        <footer className="vela-explore-sky__footer">
          <span>Reference survey · DSS2 / CDS</span>
          <nav aria-label="Target pages"><span>Page 1 of 1 · workshop snapshot</span><Button disabled>Next subjects →</Button></nav>
        </footer>
        {selected && <details className="vela-explore-sky__subject-details">
          <summary>Subject facts & imaging advice</summary>
          <p>{selected.catalog} · {selected.kind} · {selected.constellation} · {extent(selected)}</p>
          <p>{selected.filterReason}</p>
          <p>Filter advice is for imaging. Installation is not detected.</p>
        </details>}
        <details className="vela-explore-sky__method">
          <summary>How these suggestions work & credits</summary>
          <p>Fixed workshop snapshot of nine subjects. Search and filters operate on this sample only. Times shown in America/New_York. No hardware commands or live sky updates.</p>
          <p>Reference imagery: DSS2 color / CDS. Catalog: OpenNGC by Mattia Verga and contributors, CC BY-SA 4.0.</p>
        </details>
        {values.notice && <p className="vela-explore-sky__notice" role="status">{values.notice}</p>}
      </main>
      {selected && sky && <Dialog
        open={Boolean(values.skyOpen)} onDismiss={() => update({ skyOpen: false })}
        title={`${selected.name} · Through the night`}
        description="Snapshot · America/New_York · target and Moon positions"
        dismissLabel="Close sky view" className="vela-explore-sky__dialog"
      >
        <SkyPath
          targetName={selected.name}
          samples={sky.samples.map(sample => ({ ...sample, label: time(sample.at), light: lightPhase(sample.sunAltitudeDegrees) }))}
          moonSamples={sky.samples.map(sample => sample.moon)}
          selectedIndex={selectedIndex}
          onSelectedIndexChange={skyIndex => update({ skyIndex })}
          nowIndex={nearestSample(sky)} nowLabel="Snapshot"
        />
        <p className="vela-explore-sky__dialog-note">Light boundaries approximate · 15-minute samples</p>
      </Dialog>}
    </article>
  )
}

export const specimen: ComponentSpecimen = {
  componentId: 'panel', componentName: 'Panel / Card', id: 'panel-explore-sky',
  name: 'Explore sky access · Draft product example',
  description: 'Current Explore composition with one change: a sky-path icon beside the selected subject opens a bounded sky dialog. Nine fixed subjects; no live device operations.',
  controls: {
    target: { type: 'select', label: 'Selected subject', options: targets.map(target => target.id) },
    query: { type: 'text', label: 'Search' },
    category: { type: 'select', label: 'Object type', options: categories.map(category => category.value) },
    filter: { type: 'select', label: 'Imaging preference', options: filters.map(filter => filter.value) },
    skyOpen: { type: 'boolean', label: 'Sky dialog open' },
    skyIndex: { type: 'text', label: 'Sky time sample' },
  },
  defaultProps: { target: 'ngc7000', query: '', category: 'all', filter: 'all', skyOpen: false, skyIndex: 21, notice: '' },
  render: (props, onPropsChange) => <ExploreSky props={props} {...(onPropsChange ? { onPropsChange } : {})} />,
}
