import './DiscoveryScanner.css'

export function DiscoveryScanner() {
  return (
    <div aria-hidden="true" className="rig-discovery-scanner">
      <span className="rig-discovery-scanner__sweep" />
      <span className="rig-discovery-scanner__signal rig-discovery-scanner__signal--one" />
      <span className="rig-discovery-scanner__signal rig-discovery-scanner__signal--two" />
      <span className="rig-discovery-scanner__signal rig-discovery-scanner__signal--three" />
    </div>
  )
}
