import { IconButton, Panel, Badge } from '@vela/ui'

import { RefreshIcon } from "../components/ui/icons";
import { classes } from "../components/ui/utils";
import { useHome } from "../pages/useHome";

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
  const { home, loading, error, refresh} = useHome();

  return (
    <section>
      <div className={classes(
        'mx-auto max-w-[80vw] mt-8',
      )}>
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold">Devices</span>
          <IconButton
            type="button"
            label="Refresh devices"
            tone="quiet"
            icon={<RefreshIcon />}
            onClick={refresh}
            disabled={loading}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-8">
          {loading ? (
            <Loading />
          ) : error ? (
            <p role="alert">{error}</p>
          ) : (
            home?.rigs.map(rig => (
              <Panel
                key={rig.id}
                title={rig.name}
                description={`${rig.devices.length} devices`}
                elevation="raised"
              >
                <ul className="flex flex-col gap-2">
                  {rig.devices.map(device => {
                    const presentation = connectionBadge[device.connection]

                    return (
                      <li className="flex items-center justify-between" key={device.id}>
                        <span className="text-sm">{device.name}</span>

                        <Badge
                          size="small"
                          tone={presentation.tone}
                          marker={<i />}
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
    </section>
  )
}

function Loading() {
  return (
    <div>Loading...</div>
  )
}
