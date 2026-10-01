import type { RigView } from '@vela/model/rig'
import { Button } from '@vela/ui'
import { useState } from 'react'
import { Link } from 'react-router'
import RigDiscoveryDialog from '../features/rig-discovery/RigDiscoveryDialog'
import { useHome } from '../pages/useHome'
import './home.css'

export function Home() {
  const { home, loading, error, refresh } = useHome()
  const [discoveryOpen, setDiscoveryOpen] = useState(false)
  const populated = Boolean(home?.rigs.length)
  const firstNight = home?.rigs.length === 0

  async function handleAdded() {
    setDiscoveryOpen(false)
    await refresh()
  }

  function dismissDiscovery() {
    setDiscoveryOpen(false)
  }

  return (
    <section className="vela-home">
      <header className="vela-home__heading">
        <p className="vela-home__context">{firstNight ? 'Tonight' : 'Your observatory'}</p>
        <div>
          <h1>{firstNight ? 'Connect your first rig' : 'Your rigs'}</h1>
          {populated && (
            <Button id="home-add-rig" tone="accent" onClick={() => setDiscoveryOpen(true)}>
              Add a rig
            </Button>
          )}
        </div>
        <p>
          {firstNight
            ? 'Add the computer that serves your astronomy devices, then choose a camera.'
            : populated
              ? 'Choose a rig to inspect its equipment. Adding a rig does not connect its devices.'
              : 'Manage the computers that serve your astronomy devices.'}
        </p>
      </header>

      {error ? (
        <p className="vela-home__error" role="alert">
          {error}{' '}
          <Button disabled={loading} onClick={() => void refresh()}>
            Refresh rigs
          </Button>
        </p>
      ) : null}

      {home === undefined && loading ? (
        <div aria-live="polite" className="vela-home__state">
          Loading Rigs…
        </div>
      ) : home === undefined ? (
        <div className="vela-home__state">
          <h2>Could not load your Rigs</h2>
          <p>Check the Vela server and try again.</p>
          <Button disabled={loading} onClick={() => void refresh()}>
            Try again
          </Button>
        </div>
      ) : home.rigs.length === 0 ? (
        <NoRigs onSetup={() => setDiscoveryOpen(true)} />
      ) : (
        <div className="vela-home__catalog">
          {home.rigs.map((rig) => (
            <RigCard key={rig.id} rig={rig} />
          ))}
        </div>
      )}

      <RigDiscoveryDialog onAdded={handleAdded} onDismiss={dismissDiscovery} open={discoveryOpen} />
    </section>
  )
}

function RigCard({ rig }: { readonly rig: RigView }) {
  const status =
    rig.reachability === 'unreachable'
      ? 'Not reachable'
      : rig.reachability === 'unknown'
        ? 'Needs attention'
        : rig.connections.connected === rig.connections.total && rig.connections.total > 0
          ? 'Connected'
          : rig.connections.connected > 0
            ? 'Partly connected'
            : 'Not connected'

  return (
    <Link aria-label={`View ${rig.name}`} to={`/rigs/${encodeURIComponent(rig.id)}`}>
      <div>
        <h2>{rig.name}</h2>
        <span>{status}</span>
      </div>
      <p>
        {rig.reachability === 'reachable'
          ? `${rig.connections.connected} of ${rig.connections.total} devices connected`
          : `${rig.connections.total} devices in saved inventory`}
      </p>
      <p>{rig.lastSeenAt ? `Last seen ${formatDateTime(rig.lastSeenAt)}` : 'Not yet seen'}</p>
      <span>View equipment →</span>
    </Link>
  )
}

const steps = [
  [
    'Add your rig',
    'Use its local network address to find the devices exposed by its ALPACA server.',
  ],
  ['Connect a camera', 'Choose the imaging camera and check its connection in Equipment.'],
  ['Take a first exposure', 'Choose a duration, start capture, and inspect the image in Tonight.'],
]

function NoRigs({ onSetup }: { readonly onSetup: () => void }) {
  return (
    <div className="vela-home__layout">
      <section className="vela-home__empty" aria-label="First exposure">
        <svg
          width="160"
          height="120"
          viewBox="0 0 160 120"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M36 36L116 18L128 52L48 70Z" />
          <path d="M70 66L84 82M84 82L56 112M84 82L111 112M84 82V113" />
          <circle cx="84" cy="82" r="5" fill="currentColor" stroke="none" />
        </svg>
        <div className="vela-home__empty-copy">
          <h2>Your latest exposure will appear in Tonight</h2>
          <p>Start with a rig. Your sky is still available to explore.</p>
        </div>
        <div className="vela-home__empty-actions">
          <Button id="home-add-rig" onClick={onSetup} tone="accent">
            Add a rig
          </Button>
          <Link className="vela-button" to="/explore">
            Explore the sky
          </Link>
        </div>
      </section>
      <ol className="vela-home__steps">
        {steps.map(([title, text], index) => (
          <li key={title}>
            <span>0{index + 1}</span>
            <div>
              <h2>{title}</h2>
              <p>{text}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}
