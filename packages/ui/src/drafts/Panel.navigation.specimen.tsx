import { z } from 'zod'
import type { NavigationActivity, NavigationBarProps } from '../components/NavigationBar'
import { useState } from 'react'
import type { MouseEvent } from 'react'
import { Button, NavigationBar, Panel } from '../components'
import type { ComponentSpecimen } from '../themes'
import { CaptureRunExposure } from './CaptureRunExposure'
import { targets } from './target-framing/fixtures'
import './Panel.navigation.specimen.css'

type Props = Record<string, string | number | boolean>

const rigs = { askar: 'Askar FRA 400', seestar: 'Seestar S30' } as const

const destinations = [['observe', 'Observe'], ['targets', 'Targets'], ['capture', 'Capture']] as const

function NavigationPreview({ props, onPropsChange }: { props: Props; onPropsChange?: (patch: Props) => void }) {
  function selectedRig(): 'askar' | 'seestar' | 'all' {
    switch (values.rig) {
      case 'seestar':
        return 'seestar'
      case 'all':
        return 'all'
      default:
        return 'askar'
    }
  }

  function pageTitle() {
    switch (page) {
      case 'targets':
        return 'Find your next subject'
      case 'target':
        return target.name
      case 'capture':
        return 'Capture'
      case 'saved':
        return 'Saved images'
      case 'devices':
        return 'Rig details'
      default:
        return 'Observe'
    }
  }

  function pageDescription() {
    switch (page) {
      case 'targets':
        return 'Browse the sky while your rig keeps working.'
      case 'capture':
        return currentCapture ? interrupted ? 'Connection interrupted · last known capture shown.' : 'The latest exposure stays close at hand.' : 'No capture is running on this rig.'
      case 'observe':
        return 'Your rig, ready for the next step.'
      default:
        return 'A little page context to try the navigation.'
    }
  }

  function renderPage() {
    switch (page) {
      case 'targets':
        return <div className="vela-nav-demo__targets">{targets.slice(0, 2).map(target => <article key={target.id}><img src={target.image} alt={`${target.name} reference photograph`} /><div><p>{target.catalog}</p><h2>{target.name}</h2><a href="#target" onClick={event => {
            event.preventDefault()
            update({ page: 'target', target: target.id })
          }}>Explore target →</a><small>{target.credit} · <a href={target.source} target="_blank" rel="noreferrer">Source</a> · CC BY 4.0</small></div></article>)}</div>
      case 'target':
        return <><a className="vela-nav-demo__back" href="#targets" onClick={event => link(event, 'targets')}>← Targets</a><img className="vela-nav-demo__target-image" src={target.image} alt={`${target.name} reference photograph`} /><p className="vela-nav-demo__credit">{target.credit} · <a href={target.source} target="_blank" rel="noreferrer">Source</a> · CC BY 4.0</p></>
      case 'capture':
        return <div className="vela-nav-demo__capture"><div className="vela-nav-demo__exposure"><>{completed > 0 ? <CaptureRunExposure frame={completed} conditions="clear" /> : <p>No completed exposure yet</p>}</></div><Panel title="Latest exposure"><p>{completed > 0 ? `Frame #${completed} · 60 seconds · synthetic image` : 'Waiting for the first completed image.'}</p><strong>{currentCapture ? captureStatus : 'No active capture'}</strong>{currentCapture && interrupted && <p>The current outcome is unknown. This image and status are from the last update.</p>}<a href="#saved" onClick={event => link(event, 'saved')}>Saved images →</a></Panel></div>
      case 'saved':
        return <Panel title="Retained exposures"><p>Your saved frames belong here, one step from Capture or Observe.</p><a href="#capture" onClick={event => link(event, 'capture')}>Back to Capture →</a></Panel>
      case 'devices':
        return <Panel title="Device state"><p>{rig === 'all' ? 'All rigs' : rigs[rig]} · sample device details</p><p>Connection and setup controls remain on the rig page.</p><a href="#observe" onClick={event => link(event, 'observe')}>Back to Observe →</a></Panel>
      default:
        return <div className="vela-nav-demo__observe"><Panel title={currentCapture ? interrupted ? 'Capture updates interrupted' : 'Capture in progress' : 'Ready to observe'}><p>{currentCapture ? interrupted ? `Last seen exposing #${completed + 1}. Open Capture to inspect what is known.` : `${captureStatus}. You can keep exploring while it finishes.` : 'Choose a subject, inspect the field, or begin a capture.'}</p><Button tone="quiet" onClick={() => navigate(currentCapture ? 'capture' : 'targets')}>{currentCapture ? 'Open Capture' : 'Find a target'} →</Button></Panel><div className="vela-nav-demo__secondary"><a href="#devices" onClick={event => link(event, 'devices')}>Rig details →</a><a href="#saved" onClick={event => link(event, 'saved')}>Saved images →</a></div></div>
    }
  }

  const [local, setLocal] = useState(props)
  const values = onPropsChange ? props : local
  const update = (patch: Props) => onPropsChange ? onPropsChange(patch) : setLocal(current => ({ ...current, ...patch }))
  const rig = selectedRig()
  const page = String(values.page)
  const phase = String(values.phase)
  const activePage = page === 'target' ? 'targets' : page === 'saved' || page === 'devices' ? 'observe' : page
  const target = targets.find(target => target.id === values.target) ?? targets[1]!
  const activity = phase !== 'idle'
  const interrupted = phase === 'interrupted'
  const reading = phase === 'reading'
  const completed = Math.max(0, Math.floor(Number(values.completed) || 0))
  const elapsed = Math.max(0, Math.min(60, Number(values.elapsed) || 0))
  const captureStatus = interrupted ? `Last seen exposing #${completed + 1}` : reading ? `Reading exposure #${completed + 1}` : `Exposing #${completed + 1} · ${60 - elapsed} seconds remaining`
  const navigate = (next: string, nextRig = rig) => update({ page: next, rig: nextRig })

  const link = (event: MouseEvent<HTMLAnchorElement>, next: string, nextRig = rig) => {
    event.preventDefault()
    navigate(next, nextRig)
  }

  const currentCapture = rig === 'askar' && activity

  const navigation: Pick<NavigationBarProps, 'activity'> = {}

  if (activity) {
    const capture: NavigationActivity = {
      href: '#capture',
      onClick: event => link(event, 'capture', 'askar'),
      label: `${interrupted ? 'Capture updates lost' : 'Capture running'} on Askar FRA 400. ${completed} captured. ${interrupted ? 'Last known count. Current outcome unknown.' : reading ? 'Reading image.' : `Current exposure ${elapsed} of 60 seconds.`} Open capture.`,
      completedCount: completed,
      status: interrupted ? 'Updates lost' : reading ? 'Reading image' : `${elapsed} / 60s`,
      interrupted,
    }

    if (rig !== 'askar') capture.rigName = 'Askar'

    if (!interrupted && !reading) capture.progress = { value: elapsed, max: 60 }

    if (interrupted) capture.note = 'Last known · open Capture →'
    else if (reading) capture.note = 'Waiting for image →'
    navigation.activity = capture
  }

  return <section className="vela-nav-demo" aria-label="Navigation experiment">
    <p className="vela-nav-demo__fixture">Interactive workshop example · sample rig states</p>
    <div className="vela-nav-demo__app">
      <NavigationBar
        home={{ href: '#rigs', onClick: event => link(event, 'observe', 'all') }}
        rigs={[{ id: 'all', name: 'All rigs' }, ...Object.entries(rigs).map(([id, name]) => ({ id, name }))]}
        currentRigId={rig}
        onRigChange={id => navigate('observe', z.enum(['askar', 'seestar', 'all']).parse(id))}
        links={rig === 'all' ? [] : destinations.map(([id, label]) => ({ href: `#${id}`, label, current: activePage === id, onClick: event => link(event, id) }))}
        {...navigation}
      />

      <main className="vela-nav-demo__content">
        {rig === 'all' ? <>
          <div className="vela-nav-demo__heading"><p>Your observatory</p><h1>Choose a rig</h1><span>Opening a rig changes the view. Its work keeps running.</span></div>
          <div className="vela-nav-demo__rig-cards">{Object.entries(rigs).map(([id, name]) => <Panel key={id}><h2>{name}</h2><p>{id === 'askar' && activity ? interrupted ? 'Capture updates lost · last seen exposing' : `Capture running · ${completed} captured` : 'No active capture'}</p><Button tone="quiet" onClick={() => navigate('observe', z.enum(['askar', 'seestar', 'all']).parse(id))}>Open rig →</Button></Panel>)}</div>
        </> : <>
          <div className="vela-nav-demo__heading"><p>{rigs[rig]}</p><h1>{pageTitle()}</h1><span>{pageDescription()}</span></div>
          {renderPage()}
        </>}
      </main>
    </div>
    <footer className="vela-nav-demo__try"><label>Try the bar with<select value={phase} onChange={event => update({ phase: event.target.value })}><option value="idle">Nothing running</option><option value="capturing">Askar capturing</option><option value="reading">Askar reading an image</option><option value="interrupted">Askar updates interrupted</option></select></label>{phase === 'capturing' && <label>Exposure elapsed <input aria-label="Sample exposure elapsed seconds" type="range" min="0" max="60" value={elapsed} onChange={event => update({ elapsed: Number(event.target.value) })} /><span>{elapsed}s</span></label>}<p>Switch pages or rigs, then use the activity link to return to Askar’s capture. All actions stay inside this example.</p></footer>
  </section>
}

export const specimen: ComponentSpecimen = {
  componentId: 'panel', componentName: 'Panel / Card', id: 'panel-navigation', name: 'Observatory navigation · Experiment',
  description: 'A quiet bar for rig context, three observing destinations and a return path to active capture. Uses the stable NavigationBar with sample states only; no device commands.',
  controls: {
    rig: { type: 'select', label: 'Viewing rig', options: ['askar', 'seestar', 'all'] },
    page: { type: 'select', label: 'Page', options: ['observe', 'targets', 'target', 'capture', 'saved', 'devices'] },
    phase: { type: 'select', label: 'Askar activity', options: ['idle', 'capturing', 'reading', 'interrupted'] },
    completed: { type: 'text', label: 'Completed exposures' },
    elapsed: { type: 'text', label: 'Current exposure elapsed (0–60s)' },
    target: { type: 'select', label: 'Sample target', options: ['m13', 'crescent', 'andromeda'] },
  },
  defaultProps: { rig: 'askar', page: 'targets', phase: 'capturing', target: 'crescent', completed: 17, elapsed: 18 },
  render: (props, onPropsChange) => <NavigationPreview props={props} {...(onPropsChange ? { onPropsChange } : {})} />,
}
