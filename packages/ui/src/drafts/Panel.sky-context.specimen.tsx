import { useId, useRef, useState } from 'react'
import { Button, Dialog, Input, NavigationBar, Panel, SkyPath } from '../components'
import { getMoonSamples, getSkySamples } from '../components/sky-path/fixtures'
import type { ComponentSpecimen } from '../themes'
import { targets } from './target-framing/fixtures'
import './Panel.sky-context.specimen.css'

type Props = Record<string, string | number | boolean>

const target = targets[1]!

const samples = getSkySamples('crescent').map((sample, index) => ({
  ...sample,
  light: index < 3 ? 'civil' as const
    : index < 6 ? 'nautical' as const
      : index < 9 ? 'astronomical' as const : 'night' as const,
}))

const moon = getMoonSamples()

function SkyContext({ props, onPropsChange }: {
  props: Props
  onPropsChange?: (patch: Props) => void
}) {
  const [local, setLocal] = useState(props)
  const values = onPropsChange ? props : local

  const update = (patch: Props) => onPropsChange
    ? onPropsChange(patch)
    : setLocal(current => ({ ...current, ...patch }))

  const night = useRef<HTMLElement>(null)
  const id = useId()
  const explore = values.view === 'Explore'
  const skyIndex = Math.max(0, Math.min(48, Number(values.skyIndex) || 0))

  const sky = (
    <SkyPath
      samples={samples}
      moonSamples={moon}
      targetName={target.name}
      selectedIndex={skyIndex}
      onSelectedIndexChange={index => update({ skyIndex: index })}
      nowIndex={18}
      nowLabel="Sample now"
      compact
    />
  )

  const showSky = () => {
    if (explore) update({ skyOpen: true })
    else night.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <article className="vela-sky-context">
      <NavigationBar
        home={{ href: '#', onClick: event => event.preventDefault() }}
        rigs={[{ id: 'askar', name: 'Askar FRA 400' }]}
        currentRigId="askar" onRigChange={() => {}}
        links={['Tonight', 'Explore the sky', 'Photographs'].map(label => ({
          label, href: `#${label.toLowerCase()}`,
          current: explore ? label === 'Explore the sky' : label === 'Tonight',
          onClick: event => {
            event.preventDefault()

            if (label !== 'Photographs') update({ view: label === 'Explore the sky' ? 'Explore' : 'Framing' })
          },
        }))}
        utility={<span>Workshop · sample night</span>}
      />
      <main className="vela-sky-context__main">
        <header className="vela-sky-context__heading">
          <div>
            <p>{explore ? 'Explore tonight' : 'Observe / Targets & framing'}</p>
            <h1>{explore ? 'Find your next subject' : target.name}</h1>
            <p>{explore ? 'One selected subject · illustrative Explore layout' : 'NGC 6888 · Emission nebula'}</p>
          </div>
          {!explore && <Button onClick={() => update({ view: 'Explore' })}>Choose another target</Button>}
        </header>
        {explore ? (
          <>
            <div className="vela-sky-context__search"><Input label="Find a subject" placeholder="Name or catalog number" value={String(values.query)} onChange={event => update({ query: event.target.value })} /></div>
            <section className="vela-sky-context__candidates" aria-label="Selected sample target">
              {targets.filter(item => item.id === target.id && `${item.name} ${item.catalog}`.toLowerCase().includes(String(values.query).toLowerCase())).map(item => (
                <article key={item.id} className="vela-sky-context__candidate" aria-label="Selected sample target">
                  <img src={item.image} alt="" /><span><strong>{item.name}</strong><small>{item.catalog} · {item.kind}</small></span>
                </article>
              ))}
            </section>
            <Panel className="vela-sky-context__selected">
              <div className="vela-sky-context__selected-copy"><p>Selected subject</p><h2>{target.name}</h2><p>{target.description}</p></div>
              <div className="vela-sky-context__summary">
                <div><span>Sample observing window</span><strong>20:00–04:00</strong></div>
                <div><span>Highest in the sky</span><strong>76° at 00:00</strong></div>
                <Button onClick={showSky}>View sky path</Button>
                <Button tone="accent" onClick={() => update({ view: 'Framing' })}>Frame this target</Button>
              </div>
              <details><summary>Subject facts & imaging advice</summary><p>Emission nebula · A dual-band filter can isolate its hydrogen and oxygen emission. Reference photograph and sky geometry are illustrative.</p></details>
            </Panel>
          </>
        ) : (
          <>
            <div className="vela-sky-context__summary vela-sky-context__summary--top">
              <div><span>Sample observing window</span><strong>20:00–04:00</strong></div>
              <div><span>Highest in the sky</span><strong>76° at 00:00</strong></div>
              <Button onClick={showSky}>View sky path ↓</Button>
            </div>
            <div className="vela-sky-context__framing">
              <section className="vela-sky-context__composition" aria-label="Frame composition">
                <header><h2>Compose your image</h2><span>Reference photograph</span></header>
                <div className="vela-sky-context__image">
                  <img src={target.image} alt="Reference photograph of the Crescent Nebula" />
                  <div className="vela-sky-context__frame" style={{ left: `${Number(values.frameX)}%` }}><span>Illustrative camera frame</span><i>+</i></div>
                </div>
                <footer><span>Illustrative field · 400 mm optics</span><a href={target.source} target="_blank" rel="noreferrer">Image credit ↗</a></footer>
                <details className="vela-sky-context__controls">
                  <summary>Frame position & controls</summary>
                  <div className="vela-sky-context__control-fields">
                    <label htmlFor={`${id}-position`}>Horizontal frame position<input id={`${id}-position`} type="range" min="35" max="65" value={Number(values.frameX)} onChange={event => update({ frameX: Number(event.target.value) })} /></label>
                    <Input label="Effective focal length (mm)" type="number" value={String(values.focalLength)} onChange={event => update({ focalLength: event.target.value })} />
                    <Button onClick={() => update({ notice: 'Sample focal length saved. The reference photograph is not calibrated.' })}>Save focal length</Button>
                  </div>
                </details>
                <details className="vela-sky-context__controls">
                  <summary>Framing details & state</summary>
                  <dl><div><dt>Camera</dt><dd>ZWO ASI2600MC Pro · sample</dd></div><div><dt>Exposure</dt><dd>2 s</dd></div><div><dt>Orientation</dt><dd>Assumed north-up · not measured</dd></div><div><dt>Field of view</dt><dd>3.36° × 2.25° · illustrative</dd></div></dl>
                </details>
              </section>
              <aside className="vela-sky-context__actions">
                <h2>Your composition</h2><p>Position the camera frame, then center the rig on your composition.</p>
                <div className="vela-sky-context__ready"><strong>Ready to frame</strong><span>Sample mount and camera connected</span></div>
                <Input label="Test exposure (seconds)" type="number" value={String(values.exposure)} onChange={event => update({ exposure: event.target.value })} />
                <Button tone="accent" onClick={() => update({ notice: 'Design preview only. No mount or camera command was sent.' })}>Slew & check</Button>
                <p>Moves the mount and uses test exposures to refine the pointing.</p>
                <Button onClick={() => update({ notice: 'Design preview only. No exposure was taken.' })}>Check current frame</Button>
                <p>Takes a test exposure without moving the mount.</p>
                <section className="vela-sky-context__last-test" aria-label="Last test exposure">
                  <h3>Last test exposure</h3>
                  <p>No test exposure yet. Check the current frame to inspect the camera’s view here.</p>
                </section>
              </aside>
            </div>
            <section ref={night} className="vela-sky-context__night" aria-labelledby={`${id}-night`}>
              <header><div><h2 id={`${id}-night`}>Through the night</h2><p>See where the target will be as the night unfolds.</p></div><Button onClick={() => update({ skyOpen: true })}>Expand sky view</Button></header>
              <div className="vela-sky-context__night-layout">
                <div className="vela-sky-context__chart">{sky}</div>
                <div className="vela-sky-context__night-facts"><div><span>Sample observing window</span><strong>20:00–04:00</strong><p>Above the geometric horizon throughout this sample night.</p></div><div><span>Highest altitude</span><strong>76° at midnight</strong><p>Scrub the time to follow its path from east to west.</p></div><p>Illustrative sky · local obstructions not included</p></div>
              </div>
            </section>
          </>
        )}
        {values.notice && <p className="vela-sky-context__notice" role="status">{values.notice}</p>}
        <footer className="vela-sky-context__footer">Workshop proposal · Invented sky and camera geometry · No hardware commands<br />Reference image: {target.credit} · CC BY 4.0 · Cropped for display</footer>
      </main>
      <Dialog open={Boolean(values.skyOpen)} onDismiss={() => update({ skyOpen: false })} title={`${target.name} · Through the night`} description="Illustrative night · 20:00–04:00 · Highest 76° at midnight" className="vela-sky-context__dialog">
        {sky}
      </Dialog>
    </article>
  )
}

export const specimen: ComponentSpecimen = {
  componentId: 'panel', componentName: 'Panel / Card', id: 'panel-sky-context',
  name: 'Sky context & framing · Draft product example',
  description: 'Visible night context in framing and Explore, attached framing details, and a shallow sky section. Invented geometry and reference photographs; no device commands.',
  controls: {
    view: { type: 'select', label: 'Page', options: ['Framing', 'Explore'] },
    skyIndex: { type: 'text', label: 'Sky time sample (0–48)' },
    skyOpen: { type: 'boolean', label: 'Expanded sky view' },
    query: { type: 'text', label: 'Target search' },
    frameX: { type: 'text', label: 'Frame horizontal position (%)' },
    focalLength: { type: 'text', label: 'Sample focal length' },
    exposure: { type: 'text', label: 'Test exposure' },
  },
  defaultProps: { view: 'Framing', skyIndex: 18, skyOpen: false, query: '', frameX: 50, focalLength: 400, exposure: 2, notice: '' },
  render: (props, onPropsChange) => <SkyContext props={props} {...(onPropsChange ? { onPropsChange } : {})} />,
}
