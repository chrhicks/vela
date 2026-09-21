import type { RigView } from '@vela/model/rig'
import { Badge, Button } from '@vela/ui'
import { useState } from 'react'
import { Link } from 'react-router'
import RigDiscoveryDialog from '../features/rig-discovery/RigDiscoveryDialog'
import { useHome } from '../pages/useHome'

const reachabilityBadge = {
  reachable: { label: 'Reachable', tone: 'positive' },
  unreachable: { label: 'Offline', tone: 'danger' },
  unknown: { label: 'Needs attention', tone: 'warning' },
} as const

export function Home() {
  const { home, loading, error, refresh } = useHome()
  const [discoveryOpen, setDiscoveryOpen] = useState(false)
  const [initialDiscoveryDismissed, setInitialDiscoveryDismissed] = useState(false)
  const noRigs = !loading && !error && home?.rigs.length === 0

  async function handleAdded() {
    setDiscoveryOpen(false)
    setInitialDiscoveryDismissed(true)
    await refresh()
  }

  function dismissDiscovery() {
    setDiscoveryOpen(false)
    setInitialDiscoveryDismissed(true)
  }

  return (
    <section className="vela-rig-home">
      <div className="vela-rig-home__heading">
        <div>
          <small>OBSERVATORY</small>
          <h1>Rigs</h1>
          <p>Choose a Rig to see what is connected and what it is doing.</p>
        </div>
        {home && home.rigs.length > 0 ? (
          <Button onClick={() => setDiscoveryOpen(true)} size="small" tone="accent">
            Add rig
          </Button>
        ) : null}
      </div>

      {error ? (
        <p className="vela-rig-home__error" role="alert">
          {error}
        </p>
      ) : null}

      {home === undefined && loading ? (
        <div aria-live="polite" className="vela-rig-home__loading">
          Loading Rigs…
        </div>
      ) : home === undefined ? (
        <div className="vela-rig-route-state">
          <h2>Could not load your Rigs</h2>
          <p>Check the Vela server and try again.</p>
          <Button disabled={loading} onClick={() => void refresh()}>
            Try again
          </Button>
        </div>
      ) : home.rigs.length === 0 ? (
        <NoRigs onSetup={() => setDiscoveryOpen(true)} />
      ) : (
        <div className="vela-rig-home__grid">
          {home.rigs.map(rig => (
            <RigCard key={rig.id} rig={rig} />
          ))}
        </div>
      )}

      <RigDiscoveryDialog
        onAdded={handleAdded}
        onDismiss={dismissDiscovery}
        open={discoveryOpen || (noRigs && !initialDiscoveryDismissed)}
      />
    </section>
  )
}

function RigCard({ rig }: { readonly rig: RigView }) {
  const reachability = reachabilityBadge[rig.reachability]

  const connectionState =
    rig.connections.connected === rig.connections.total ? 'complete' : 'attention'

  return (
    <Link
      aria-label={`View ${rig.name}`}
      className="vela-rig-summary"
      to={`/rigs/${encodeURIComponent(rig.id)}`}
    >
      <div className="vela-rig-summary__heading">
        <h2>{rig.name}</h2>
        <Badge marker={<i />} size="small" tone={reachability.tone}>
          {reachability.label}
        </Badge>
      </div>
      <p className="vela-rig-summary__description">{rigDescription(rig)}</p>
      <div className="vela-rig-summary__footer">
        <span className="vela-rig-summary__connections" data-state={connectionState}>
          <strong>
            {rig.connections.connected} of {rig.connections.total}
          </strong>
          <small>devices connected</small>
        </span>
        <strong>
          View rig <i>→</i>
        </strong>
      </div>
    </Link>
  )
}

function rigDescription(rig: RigView): string {
  const { disconnected, total, unavailable } = rig.connections

  if (rig.reachability !== 'reachable' && rig.lastSeenAt) {
    return `${total} ${total === 1 ? 'device' : 'devices'} · Last seen ${formatDateTime(rig.lastSeenAt)}`
  }

  if (disconnected > 0) return `${disconnected} disconnected`

  if (unavailable > 0) return `${unavailable} unavailable`

  return `${total} ${total === 1 ? 'device' : 'devices'} ready to inspect`
}

function NoRigs({ onSetup }: { readonly onSetup: () => void }) {
  return (
    <section className="vela-rig-home__empty">
      <h2>No Rigs configured</h2>
      <p>Set up the observatory you want Vela to monitor.</p>
      <Button onClick={onSetup} tone="accent">
        Set up a rig
      </Button>
    </section>
  )
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}
