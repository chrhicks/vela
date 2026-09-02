import { useState } from 'react'
import { Badge, Button, IconButton, Panel } from '@vela/ui'
import { RefreshIcon } from '../components/ui/icons'
import { classes } from '../components/ui/utils'
import RigDiscoveryDialog from '../features/rig-discovery/RigDiscoveryDialog'
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

export function Home() {
  const { home, loading, error, refresh } = useHome()
  const [discoveryDismissed, setDiscoveryDismissed] = useState(false)
  const noRigs = !loading && !error && home?.rigs.length === 0

  return (
    <section>
      <div className={classes(
        'mx-auto max-w-[80vw] mt-8',
      )}>
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold">Devices</span>
          <IconButton
            disabled={loading}
            icon={<RefreshIcon />}
            label="Refresh devices"
            onClick={refresh}
            tone="quiet"
            type="button"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-8">
          {loading ? (
            <Loading />
          ) : error ? (
            <p role="alert">{error}</p>
          ) : home === undefined ? null : home.rigs.length === 0 ? (
            <NoRigs onSetup={() => setDiscoveryDismissed(false)} />
          ) : (
            home.rigs.map((rig) => (
              <Panel
                description={`${rig.devices.length} devices`}
                elevation="raised"
                key={rig.id}
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
            ))
          )}
        </div>
      </div>

      <RigDiscoveryDialog
        onDismiss={() => setDiscoveryDismissed(true)}
        open={noRigs && !discoveryDismissed}
      />
    </section>
  )
}

function NoRigs({ onSetup }: { onSetup(): void }) {
  return (
    <div className="col-span-full grid min-h-80 place-items-center rounded-lg border border-ui-line bg-ui-surface px-6 text-center">
      <div className="grid max-w-sm justify-items-center gap-4">
        <span className="text-xs font-bold tracking-[.12em] text-ui-accent">GET STARTED</span>
        <h1 className="m-0 text-2xl font-bold">No rig configured</h1>
        <p className="m-0 text-sm leading-6 text-ui-muted">
          Set up the observatory you want Vela to monitor and control.
        </p>
        <Button onClick={onSetup} tone="accent">Set up a rig</Button>
      </div>
    </div>
  )
}

function Loading() {
  return <div>Loading...</div>
}
