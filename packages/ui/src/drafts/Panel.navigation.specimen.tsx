import { useState } from 'react'
import type { MouseEvent } from 'react'
import { Button, Panel } from '../components'
import type { ComponentSpecimen } from '../themes'
import { CaptureRunExposure } from './CaptureRunExposure'
import { targets } from './target-framing/fixtures'
import './Panel.navigation.specimen.css'

type Props = Record<string, string | number | boolean>
const rigs = { askar: 'Askar FRA 400', seestar: 'Seestar S30' } as const
const destinations = [['observe', 'Observe'], ['targets', 'Targets'], ['capture', 'Capture']] as const

function NavigationPreview({ props, onPropsChange }: { props: Props; onPropsChange?: (patch: Props) => void }) {
  const [local, setLocal] = useState(props)
  const values = onPropsChange ? props : local
  const update = (patch: Props) => onPropsChange ? onPropsChange(patch) : setLocal(current => ({ ...current, ...patch }))
  const rig = values.rig === 'seestar' ? 'seestar' : values.rig === 'all' ? 'all' : 'askar'
  const page = String(values.page)
  const phase = String(values.phase)
  const activePage = page === 'target' ? 'targets' : page === 'saved' || page === 'devices' ? 'observe' : page
  const target = targets.find(target => target.id === values.target) ?? targets[1]!
  const activity = phase !== 'idle'
  const interrupted = phase === 'interrupted'
  const navigate = (next: string, nextRig = rig) => update({ page: next, rig: nextRig })
  const link = (event: MouseEvent<HTMLAnchorElement>, next: string, nextRig = rig) => {
    event.preventDefault()
    navigate(next, nextRig)
  }
  const returnToCapture = () => navigate('capture', 'askar')
  const currentCapture = rig === 'askar' && activity

  return <section className="vela-nav-demo" aria-label="Navigation experiment">
    <p className="vela-nav-demo__fixture">Interactive workshop example · sample rig states</p>
    <div className="vela-nav-demo__app">
      <header className="vela-nav-demo__bar">
        <div className="vela-nav-demo__context">
          <a className="vela-nav-demo__brand" href="#rigs" aria-label="Vela · all rigs" onClick={event => link(event, 'observe', 'all')}>V<span>ela</span></a>
          <span className="vela-nav-demo__divider" aria-hidden="true" />
          <label className="vela-nav-demo__rig"><span className="vela-nav-demo__sr-only">Viewing rig</span><select value={rig} onChange={event => navigate('observe', event.target.value as typeof rig)}><option value="all">All rigs</option>{Object.entries(rigs).map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label>
        </div>
        {rig !== 'all' && <nav aria-label="Observing pages" className="vela-nav-demo__pages">{destinations.map(([id, label]) => <a key={id} href={`#${id}`} aria-current={activePage === id ? 'page' : undefined} onClick={event => link(event, id)}>{label}</a>)}</nav>}
        {activity && <button className="vela-nav-demo__activity" data-interrupted={interrupted || undefined} onClick={returnToCapture} aria-label={`${interrupted ? 'Capture updates lost' : 'Capture running'} on Askar FRA 400. Open capture.`}><i aria-hidden="true" /><span>{rig !== 'askar' && <small>Askar · </small>}{interrupted ? 'Updates lost' : 'Capturing · #18'}</span><span aria-hidden="true">↗</span></button>}
      </header>

      <main className="vela-nav-demo__content">
        {rig === 'all' ? <>
          <div className="vela-nav-demo__heading"><p>Your observatory</p><h1>Choose a rig</h1><span>Opening a rig changes the view. Its work keeps running.</span></div>
          <div className="vela-nav-demo__rig-cards">{Object.entries(rigs).map(([id, name]) => <Panel key={id}><h2>{name}</h2><p>{id === 'askar' && activity ? interrupted ? 'Capture updates lost · last seen exposing' : 'Capture running · exposure #18' : 'No active capture'}</p><Button tone="quiet" onClick={() => navigate('observe', id as typeof rig)}>Open rig →</Button></Panel>)}</div>
        </> : <>
          <div className="vela-nav-demo__heading"><p>{rigs[rig]}</p><h1>{page === 'targets' ? 'Find your next subject' : page === 'target' ? target.name : page === 'capture' ? 'Capture' : page === 'saved' ? 'Saved images' : page === 'devices' ? 'Rig details' : 'Observe'}</h1><span>{page === 'targets' ? 'Browse the sky while your rig keeps working.' : page === 'capture' ? currentCapture ? interrupted ? 'Connection interrupted · last known capture shown.' : 'The latest exposure stays close at hand.' : 'No capture is running on this rig.' : page === 'observe' ? 'Your rig, ready for the next step.' : 'A little page context to try the navigation.'}</span></div>
          {page === 'targets' ? <div className="vela-nav-demo__targets">{targets.slice(0, 2).map(target => <article key={target.id}><img src={target.image} alt={`${target.name} reference photograph`} /><div><p>{target.catalog}</p><h2>{target.name}</h2><a href="#target" onClick={event => {
            event.preventDefault()
            update({ page: 'target', target: target.id })
          }}>Explore target →</a><small>{target.credit} · <a href={target.source} target="_blank" rel="noreferrer">Source</a> · CC BY 4.0</small></div></article>)}</div>
          : page === 'target' ? <><a className="vela-nav-demo__back" href="#targets" onClick={event => link(event, 'targets')}>← Targets</a><img className="vela-nav-demo__target-image" src={target.image} alt={`${target.name} reference photograph`} /><p className="vela-nav-demo__credit">{target.credit} · <a href={target.source} target="_blank" rel="noreferrer">Source</a> · CC BY 4.0</p></>
          : page === 'capture' ? <div className="vela-nav-demo__capture"><div className="vela-nav-demo__exposure"><CaptureRunExposure frame={17} conditions="clear" /></div><Panel title="Latest exposure"><p>Frame #17 · 60 seconds · synthetic image</p><strong>{currentCapture ? interrupted ? 'Last seen exposing #18' : 'Exposing #18 · 42 seconds remaining' : 'No active capture'}</strong>{currentCapture && interrupted && <p>The current outcome is unknown. This image and status are from the last update.</p>}<a href="#saved" onClick={event => link(event, 'saved')}>Saved images →</a></Panel></div>
          : page === 'saved' ? <Panel title="Retained exposures"><p>Your saved frames belong here, one step from Capture or Observe.</p><a href="#capture" onClick={event => link(event, 'capture')}>Back to Capture →</a></Panel>
          : page === 'devices' ? <Panel title="Device state"><p>{rigs[rig]} · sample device details</p><p>Connection and setup controls remain on the rig page.</p><a href="#observe" onClick={event => link(event, 'observe')}>Back to Observe →</a></Panel>
          : <div className="vela-nav-demo__observe"><Panel title={currentCapture ? interrupted ? 'Capture updates interrupted' : 'Capture in progress' : 'Ready to observe'}><p>{currentCapture ? interrupted ? 'Last seen exposing #18. Open Capture to inspect what is known.' : 'Exposure #18 is underway. You can keep exploring while it finishes.' : 'Choose a subject, inspect the field, or begin a capture.'}</p><Button tone="quiet" onClick={() => navigate(currentCapture ? 'capture' : 'targets')}>{currentCapture ? 'Open Capture' : 'Find a target'} →</Button></Panel><div className="vela-nav-demo__secondary"><a href="#devices" onClick={event => link(event, 'devices')}>Rig details →</a><a href="#saved" onClick={event => link(event, 'saved')}>Saved images →</a></div></div>}
        </>}
      </main>
    </div>
    <footer className="vela-nav-demo__try"><label>Try the bar with<select value={phase} onChange={event => update({ phase: event.target.value })}><option value="idle">Nothing running</option><option value="capturing">Askar capturing</option><option value="interrupted">Askar updates interrupted</option></select></label><p>Switch pages or rigs, then use the activity link to return to Askar’s capture. All actions stay inside this example.</p></footer>
  </section>
}

export const specimen: ComponentSpecimen = {
  componentId: 'panel', componentName: 'Panel / Card', id: 'panel-navigation', name: 'Observatory navigation · Experiment',
  description: 'A quiet bar for rig context, three observing destinations and a return path to active capture. Sample states only; no device commands or application adoption.',
  controls: {
    rig: { type: 'select', label: 'Viewing rig', options: ['askar', 'seestar', 'all'] },
    page: { type: 'select', label: 'Page', options: ['observe', 'targets', 'target', 'capture', 'saved', 'devices'] },
    phase: { type: 'select', label: 'Askar activity', options: ['idle', 'capturing', 'interrupted'] },
    target: { type: 'select', label: 'Sample target', options: ['m13', 'crescent', 'andromeda'] },
  },
  defaultProps: { rig: 'askar', page: 'targets', phase: 'capturing', target: 'crescent' },
  render: (props, onPropsChange) => <NavigationPreview props={props} {...(onPropsChange ? { onPropsChange } : {})} />,
}
