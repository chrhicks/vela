import './DiscoveryOrbit.css'

export function DiscoveryOrbit() {
  return (
    <div aria-hidden="true" className="rig-discovery-orbit">
      <span className="rig-discovery-orbit__ring rig-discovery-orbit__ring--outer" />
      <span className="rig-discovery-orbit__ring rig-discovery-orbit__ring--inner" />
      <span className="rig-discovery-orbit__telescope">
        <svg fill="none" viewBox="0 0 32 32">
          <path d="m8 12 13-6 3 6-13 6-3-6Z" />
          <path d="m13 17 4 3m-1-1-4 8m4-8 7 7" />
          <path d="m6 10 3 7" />
        </svg>
      </span>
      <span className="rig-discovery-orbit__signal rig-discovery-orbit__signal--one" />
      <span className="rig-discovery-orbit__signal rig-discovery-orbit__signal--two" />
      <span className="rig-discovery-orbit__signal rig-discovery-orbit__signal--three" />
    </div>
  )
}
