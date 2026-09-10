import type { RigDetailView, RigDeviceDetailView } from '@vela/model/web'
import { Badge, Button, Dialog, IconButton, Panel } from '@vela/ui'
import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { RefreshIcon } from '../components/ui/icons'
import { RigDeviceCard } from '../features/rig-detail/RigDeviceCard'
import { useRigDetail } from '../features/rig-detail/use-rig-detail'
import { forgetRig } from '../features/rig-management/forget-rig'
import { ObservationMark } from '../features/observation/ObservationMark'
import './observe.css'

const kindOrder = [
  'telescope',
  'camera',
  'focuser',
  'filter-wheel',
  'observing-conditions',
  'switch',
] as const

export function RigDetail() {
  const { rigId = '' } = useParams()
  const navigate = useNavigate()
  const { view, refreshing, interrupted, initialError, refresh } = useRigDetail(rigId)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [forgetOpen, setForgetOpen] = useState(false)
  const [forgetting, setForgetting] = useState(false)
  const [forgetError, setForgetError] = useState<string>()

  async function confirmForget() {
    if (view === undefined || forgetting) return

    setForgetting(true)
    setForgetError(undefined)

    try {
      await forgetRig(view.id)
      setForgetOpen(false)
      navigate('/', { replace: true })
    } catch {
      setForgetError('Vela could not forget this rig. Check the server and try again.')
    } finally {
      setForgetting(false)
    }
  }

  if (view === undefined) {
    return (
      <section className="vela-rig-page">
        <Link className="vela-rig-page__back" to="/">← All rigs</Link>
        {initialError === undefined ? (
          <div aria-live="polite" className="vela-rig-route-state">Loading Rig…</div>
        ) : initialError === 'not-found' ? (
          <RouteMessage
            detail="This Rig is no longer saved in Vela, or the address is incorrect."
            title="Rig not found"
          />
        ) : (
          <RouteMessage
            action={<Button disabled={refreshing} onClick={() => void refresh()}>Try again</Button>}
            detail="Vela could not load this Rig. Check the server and try again."
            title="Could not load this Rig"
          />
        )}
      </section>
    )
  }

  const state = rigStatePresentation(view, interrupted)
  const devices = orderDevices(view.devices)

  return (
    <section className="vela-rig-page">
      <Link className="vela-rig-page__back" to="/">← All rigs</Link>

      <header className="vela-rig-hero">
        <div>
          <small>RIG</small>
          <h1>{view.name}</h1>
          <p>{connectionSummary(view)}</p>
        </div>
        <div className="vela-rig-hero__status">
          <Badge marker={<i />} tone={state.tone}>{state.label}</Badge>
          <span>{freshnessLabel(view, interrupted)}</span>
          <IconButton
            aria-busy={refreshing}
            className="vela-rig-refresh"
            data-refreshing={refreshing}
            disabled={refreshing}
            icon={<RefreshIcon />}
            label={refreshing ? 'Refreshing Rig' : 'Refresh Rig'}
            onClick={() => void refresh()}
            size="small"
            tone="quiet"
            type="button"
          />
        </div>
      </header>

      <Panel className="vela-observe-entry" elevation="raised">
        <span className="vela-observe-entry-mark"><ObservationMark /></span>
        <div><small>Observation workspace</small><h2>Ready to use this Rig?</h2>
          <p>Open a focused workspace for preparing and observing with {view.name}.</p>
        </div>
        <Button tone="accent" size="large" onClick={() => navigate(`/rigs/${encodeURIComponent(view.id)}/observe`)}>Start observing</Button>
      </Panel>

      {interrupted ? (
        <Notice
          detail="Showing the most recent values Vela received. They may no longer describe the Rig."
          title="Live updates are interrupted"
          tone="warning"
        />
      ) : view.state === 'offline' ? (
        <Notice
          detail={`Vela cannot reach ${formatEndpoint(view)}. Device names come from the last successful inventory.`}
          title="This Rig is offline"
          tone="danger"
        />
      ) : view.state === 'needs-attention' ? (
        <Notice
          detail="Vela reached the Rig but could not confirm all of its current state."
          title="This Rig needs attention"
          tone="warning"
        />
      ) : null}

      <section aria-labelledby="rig-devices-title" className="vela-rig-devices">
        <div className="vela-rig-section-heading">
          <div><small>EQUIPMENT</small><h2 id="rig-devices-title">Devices</h2></div>
          <span>Refreshes every 5 seconds</span>
        </div>
        {devices.length === 0 ? (
          <p className="vela-rig-devices__empty">No devices are currently configured for this Rig.</p>
        ) : (
          <div className="vela-rig-device-grid">
            {devices.map((device) => (
              <RigDeviceCard device={device} key={device.id} stale={interrupted} />
            ))}
          </div>
        )}
      </section>

      <section className="vela-rig-details">
        <button
          aria-expanded={detailsOpen}
          className="vela-rig-details__summary"
          onClick={() => setDetailsOpen((open) => !open)}
          type="button"
        >
          <span>
            <strong>Rig details</strong>
            <small>{formatEndpoint(view)} · Added {formatDate(view.addedAt)}</small>
          </span>
          <i aria-hidden="true">⌄</i>
        </button>
        {detailsOpen ? (
          <dl className="vela-rig-details__body">
            <div><dt>Endpoint</dt><dd>{formatEndpoint(view)}</dd></div>
            <div><dt>Added to Vela</dt><dd>{formatDateTime(view.addedAt)}</dd></div>
            <div><dt>Last inventory</dt><dd>{formatDateTime(view.lastInventoryAt)}</dd></div>
          </dl>
        ) : null}
      </section>

      <section className="vela-rig-management">
        <div>
          <strong>Remove this Rig from Vela</strong>
          <p>This only removes the saved Rig. It does not change the Alpaca server or hardware.</p>
        </div>
        {view.capabilities.includes('forget') ? (
          <Button
            className="vela-rig__forget-button"
            onClick={() => {
              setForgetError(undefined)
              setForgetOpen(true)
            }}
            size="small"
            tone="quiet"
          >
            Forget rig
          </Button>
        ) : null}
      </section>

      <Dialog
        description="This removes the saved Rig from Vela. It does not change the Alpaca server or any hardware."
        footer={(
          <>
            <Button disabled={forgetting} onClick={() => setForgetOpen(false)} tone="quiet">
              Cancel
            </Button>
            <Button
              className="vela-rig__confirm-forget"
              disabled={forgetting}
              onClick={() => void confirmForget()}
            >
              {forgetting ? 'Forgetting…' : 'Forget rig'}
            </Button>
          </>
        )}
        onDismiss={forgetting ? undefined : () => setForgetOpen(false)}
        open={forgetOpen}
        title={`Forget ${view.name}?`}
      >
        <p className="vela-rig-forget-copy">You can discover and add it again later.</p>
        {forgetError ? <p className="vela-rig-forget-error" role="alert">{forgetError}</p> : null}
      </Dialog>
    </section>
  )
}

function RouteMessage({
  action,
  detail,
  title,
}: {
  readonly action?: ReactNode
  readonly detail: string
  readonly title: string
}) {
  return (
    <div className="vela-rig-route-state">
      <h1>{title}</h1>
      <p>{detail}</p>
      {action}
    </div>
  )
}

function Notice({
  detail,
  title,
  tone,
}: {
  readonly detail: string
  readonly title: string
  readonly tone: 'warning' | 'danger'
}) {
  return (
    <div className="vela-rig-notice" data-tone={tone} role="status">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  )
}

function rigStatePresentation(view: RigDetailView, interrupted: boolean) {
  if (interrupted) return { label: 'Updates interrupted', tone: 'warning' as const }

  if (view.state === 'offline') return { label: 'Offline', tone: 'danger' as const }

  if (view.state === 'needs-attention') {
    return { label: 'Needs attention', tone: 'warning' as const }
  }

  return { label: 'Reachable', tone: 'positive' as const }
}

function connectionSummary(view: RigDetailView): string {
  const { connected, disconnected, total, unavailable } = view.connections
  const parts = [`${connected} of ${total} ${total === 1 ? 'device' : 'devices'} connected`]

  if (disconnected > 0) parts.push(`${disconnected} disconnected`)

  if (unavailable > 0) parts.push(`${unavailable} unavailable`)

  return parts.join(' · ')
}

function freshnessLabel(view: RigDetailView, interrupted: boolean): string {
  const age = formatAge(view.refreshedAt)

  if (interrupted) return `Last updated ${age}`

  return `Updated ${age}`
}

function orderDevices(
  devices: ReadonlyArray<RigDeviceDetailView>,
): ReadonlyArray<RigDeviceDetailView> {
  const ordered: RigDeviceDetailView[] = []

  for (const kind of kindOrder) {
    ordered.push(...devices.filter((device) => device.kind === kind))
  }

  ordered.push(...devices.filter((device) =>
    !kindOrder.some((kind) => kind === device.kind)))

  return ordered
}

function formatEndpoint(view: RigDetailView): string {
  return `${view.endpoint.host}:${view.endpoint.port}`
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function formatAge(value: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1_000))

  if (seconds < 5) return 'just now'

  if (seconds < 60) return `${seconds} seconds ago`
  const minutes = Math.floor(seconds / 60)

  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`
  const hours = Math.floor(minutes / 60)

  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`

  return formatDateTime(value)
}
