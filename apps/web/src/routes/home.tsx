import { RefreshIcon } from "../components/ui/icons";
import { classes } from "../components/ui/utils";
import { useHome } from "../pages/useHome";

export function Home() {
  const { home, loading, error, refresh} = useHome();
  
  return (
    <section>
      <div className={classes(
        'mx-auto max-w-[80vw] mt-8',
      )}>
        <div className="flex items-center">
          <span className="text-2xl font-bold mr-4">Devices</span>
          <button type="button" onClick={refresh} disabled={loading} aria-label="Refresh devices">
            <RefreshIcon className="size-5 text-ui-text" />
          </button>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-8">
          {loading ? (
            <Loading />
          ) : error ? (
            <p role="alert">{error}</p>
          ) : (
            home?.rigs.map(rig => (
              <div className="bg-ui-surface rounded-lg p-4" key={rig.id}>
                <h2 className="text-lg font-bold">{rig.name}</h2>
                <p className="text-sm text-ui-muted">Devices</p>
                <ul>
                  {rig.devices.map(device => (
                    <li className="flex items-center" key={device.id}>
                      <div className={classes(
                        'rounded-full h-4 w-4 mr-2',
                        device.connection === 'connected' ? 'bg-ui-positive'
                          : device.connection === 'disconnected' ? 'bg-ui-danger'
                          : 'bg-ui-warning'
                      )}></div>
                      <span className="text-sm">{device.name}</span>
                    </li>
                  ))}
                </ul>
              </div>
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