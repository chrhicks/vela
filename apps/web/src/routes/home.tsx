import type { RigView } from '@vela/model/rig'
import { Badge, Button, Dialog, IconButton, Panel } from '@vela/ui'
import { useState } from 'react'
import { RefreshIcon } from '../components/ui/icons'
import { classes } from '../components/ui/utils'
import RigDiscoveryDialog from '../features/rig-discovery/RigDiscoveryDialog'
import { forgetRig } from '../features/rig-management/forget-rig'
import { useHome } from '../pages/useHome'

const connectionBadge = {
  connected: {
    label: 'Connected',
    tone: 'positive',
  },
  disconnected: {
    label: 'Disconnected',
    tone: 'danger',
  },
  unavailable: {
    label: 'Unavailable',
    tone: 'warning',
  },
} as const

const reachabilityBadge = {
  reachable: { label: 'Reachable', tone: 'positive' },
  unreachable: { label: 'Offline', tone: 'danger' },
  unknown: { label: 'Needs attention', tone: 'warning' },
} as const

export function Home() {
  const { home, loading, error, refresh } = useHome()
  const [discoveryOpen, setDiscoveryOpen] = useState(false)
  const [initialDiscoveryDismissed, setInitialDiscoveryDismissed] = useState(false)
  const [rigToForget, setRigToForget] = useState<RigView | null>(null)
  const [forgetting, setForgetting] = useState(false)
  const [forgetError, setForgetError] = useState<string>()
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

  function askToForget(rig: RigView) {
    setForgetError(undefined)
    setRigToForget(rig)
  }

  function cancelForget() {
    if (forgetting) return
    setForgetError(undefined)
    setRigToForget(null)
  }

  async function confirmForget() {
    if (!rigToForget) return

    setForgetting(true)
    setForgetError(undefined)
    try {
      await forgetRig(rigToForget.id)
      setInitialDiscoveryDismissed(true)
      setRigToForget(null)
      await refresh()
    } catch {
      setForgetError('Vela could not forget this rig. Check the server and try again.')
    } finally {
      setForgetting(false)
    }
  }

  return (
    <section>
      <div className={classes(
        'mx-auto max-w-[80vw] mt-8',
      )}>
        <div className="flex items-center gap-2">
          <h1 className="m-0 text-2xl font-bold">Devices</h1>
          <IconButton
            disabled={loading}
            icon={<RefreshIcon />}
            label="Refresh devices"
            onClick={() => void refresh()}
            tone="quiet"
            type="button"
          />
          {home && home.rigs.length > 0 ? (
            <Button onClick={() => setDiscoveryOpen(true)} size="small" tone="accent">
              Add rig
            </Button>
          ) : null}
        </div>

        {error ? <p className="text-sm text-ui-danger" role="alert">{error}</p> : null}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-8">
          {home === undefined && loading ? (
            <Loading />
          ) : home === undefined ? null : home.rigs.length === 0 ? (
            <NoRigs onSetup={() => setDiscoveryOpen(true)} />
          ) : (
            home.rigs.map((rig) => (
              <RigCard key={rig.id} onForget={() => askToForget(rig)} rig={rig} />
            ))
          )}
        </div>
      </div>

      <RigDiscoveryDialog
        onAdded={handleAdded}
        onDismiss={dismissDiscovery}
        open={discoveryOpen || (noRigs && !initialDiscoveryDismissed)}
      />

      <Dialog
        description="This removes the saved Rig from Vela. It does not change the Alpaca server or any hardware."
        footer={(
          <>
            <Button disabled={forgetting} onClick={cancelForget} tone="quiet">Cancel</Button>
            <Button disabled={forgetting} onClick={() => void confirmForget()} tone="accent">
              {forgetting ? 'Forgetting…' : 'Forget rig'}
            </Button>
          </>
        )}
        onDismiss={forgetting ? undefined : cancelForget}
        open={rigToForget !== null}
        title={`Forget ${rigToForget?.name ?? 'this rig'}?`}
      >
        <p className="m-0 text-sm leading-6 text-ui-muted">
          You can discover and add it again later.
        </p>
        {forgetError ? <p className="text-sm text-ui-danger" role="alert">{forgetError}</p> : null}
      </Dialog>
    </section>
  )
}

function RigCard({ rig, onForget }: { rig: RigView; onForget(): void }) {
  const reachability = reachabilityBadge[rig.reachability]
  const canForget = rig.capabilities.includes('forget')

  return (
    <Panel
      action={(
        <Badge marker={<i />} size="small" tone={reachability.tone}>
          {reachability.label}
        </Badge>
      )}
      description={rigDescription(rig)}
      elevation="raised"
      footer={canForget ? (
        <Button onClick={onForget} size="small" tone="quiet">Forget rig</Button>
      ) : undefined}
      title={rig.name}
    >
      <ul className="flex flex-col gap-2">
        {rig.devices.map((device) => {
          const presentation = connectionBadge[device.connection]

          return (
            <li className="flex items-center justify-between" key={device.id}>
              <span className="text-sm">{device.name}</span>

              <Badge
                marker={<i />}
                size="small"
                tone={presentation.tone}
              >
                {presentation.label}
              </Badge>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

function rigDescription(rig: RigView): string {
  const deviceCount = `${rig.devices.length} ${rig.devices.length === 1 ? 'device' : 'devices'}`
  if (rig.reachability === 'reachable' || !rig.lastSeenAt) return deviceCount

  return `${deviceCount} · Last seen ${new Date(rig.lastSeenAt).toLocaleString()}`
}

function NoRigs({ onSetup }: { onSetup(): void }) {
  return (
    <div className="col-span-full grid min-h-80 place-items-center rounded-lg border border-ui-line bg-ui-surface px-6 text-center">
      <div className="grid max-w-sm justify-items-center gap-4">
        <span className="text-xs font-bold tracking-[.12em] text-ui-accent">GET STARTED</span>
        <h2 className="m-0 text-2xl font-bold">No rig configured</h2>
        <p className="m-0 text-sm leading-6 text-ui-muted">
          Set up the observatory you want Vela to monitor and control.
        </p>
        <Button onClick={onSetup} tone="accent">Set up a rig</Button>
      </div>
    </div>
  )
}

function Loading() {
  return <div>Loading…</div>
}
