import { CatalogBrowser } from '../features/targets/TargetBrowser'
import './targets.css'

/** The global entry is a catalog, independent of any rig or observing-site read. */
export function Explore() {
  return (
    <div className="vela-rig-page targets-page">
      <CatalogBrowser />
    </div>
  )
}
