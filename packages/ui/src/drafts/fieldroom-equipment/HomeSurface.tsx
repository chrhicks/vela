import { useState } from 'react'
import { Appearance, Button, NavigationBar, type AppearancePreference } from '../../components'
import { TelescopeMark } from './fixtures'
import '../Panel.home.specimen.css'

const steps = [
  ['Add your rig', 'Use its local network address to find the devices exposed by its ALPACA server.'],
  ['Connect a camera', 'Choose the imaging camera and check its connection in Equipment.'],
  ['Take a first exposure', 'Choose a duration, start capture, and inspect the image in Tonight.'],
]

export function HomeSurface({ populated, onAdd, onOpen, onExplore, addId }: {
  populated: boolean
  onAdd: () => void
  onOpen: () => void
  onExplore: () => void
  addId?: string
}) {
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const [preference, setPreference] = useState<AppearancePreference>('system')

  return (
    <article className="vela-home-demo" aria-label="Home product example">
      <NavigationBar
        home={{ href: '#home', onClick: event => event.preventDefault() }}
        rigs={[{ id: 'home', name: 'All rigs' }]}
        currentRigId="home"
        onRigChange={() => {}}
        utility={(
          <>
            <Appearance open={appearanceOpen} onOpenChange={setAppearanceOpen} value={preference} onValueChange={setPreference} systemMode="light" persistence="visit" />
            {!populated && <span>No rig added</span>}
          </>
        )}
        links={[{
          label: 'Explore the sky', href: '#explore',
          onClick: event => { event.preventDefault(); onExplore() },
        }]}
      />
      <header className="vela-home-demo__heading">
        <p className="vela-home-demo__context">{populated ? 'Your observatory' : 'Tonight'}</p>
        <div>
          <h1>{populated ? 'Your rigs' : 'Connect your first rig'}</h1>
          {populated && <Button id={addId} tone="accent" onClick={onAdd}>Add a rig</Button>}
        </div>
        <p>{populated ? 'Choose a rig to inspect its equipment. Adding a rig does not connect its devices.' : 'Add the computer that serves your astronomy devices, then choose a camera.'}</p>
      </header>
      {populated ? (
        <div className="vela-home-demo__catalog" aria-label="Saved rigs">
          {[
            { name: 'Askar FRA 400', updated: 'Last seen 30 Sep · 21:42', status: 'Partly connected', devices: '3 of 4 devices connected' },
            { name: 'Seestar S50', updated: 'Last seen 29 Sep · 23:10', status: 'Not reachable', devices: '2 devices in saved inventory' },
          ].map(rig => (
            <a href={`#${rig.name}`} key={rig.name} onClick={event => { event.preventDefault(); onOpen() }}>
              <div><h2>{rig.name}</h2><span>{rig.status}</span></div>
              <p>{rig.devices}</p>
              <p>{rig.updated}</p>
              <span>View equipment →</span>
            </a>
          ))}
        </div>
      ) : (
        <div className="vela-home-demo__layout">
          <section className="vela-home-demo__empty" aria-label="First exposure">
            <TelescopeMark />
            <div className="vela-home-demo__empty-copy">
              <h2>Your latest exposure will appear in Tonight</h2>
              <p>Start with a rig. Your sky is still available to explore.</p>
            </div>
            <div className="vela-home-demo__empty-actions"><Button id={addId} tone="accent" onClick={onAdd}>Add a rig</Button><Button onClick={onExplore}>Explore the sky</Button></div>
          </section>
          <ol className="vela-home-demo__steps">
            {steps.map(([title, text], index) => (
              <li key={title}><span>0{index + 1}</span><div><h2>{title}</h2><p>{text}</p></div></li>
            ))}
          </ol>
        </div>
      )}
      <footer>Design study · {populated ? 'Sample saved rigs' : 'First use'} · No hardware connected</footer>
    </article>
  )
}
