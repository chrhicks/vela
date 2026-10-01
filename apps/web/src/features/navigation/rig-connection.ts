import type { RigObservation } from '../rig-detail/RigContext'

export function rigConnectionLabel(rig: RigObservation): string {
  if (rig.interrupted) return 'Updates interrupted'

  if (rig.initialError === 'not-found') return 'Rig not found'

  if (rig.initialError || rig.view?.state === 'offline') return 'Rig unavailable'

  if (!rig.view) return 'Checking rig'
  const { total, connected, unavailable, disconnected } = rig.view.connections

  if (total === 0) return 'No devices'

  if (connected === total) return 'Connected'

  if (unavailable > 0) return 'Devices unavailable'

  if (disconnected === total) return 'Disconnected'

  return `${connected} of ${total} connected`
}
