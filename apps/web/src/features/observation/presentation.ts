import type { RigObservationView } from '@vela/model/web'

export function readinessPresentation(view: RigObservationView, connecting: boolean, interrupted: boolean) {
  if (connecting) return connectingPresentation

  if (interrupted) return {
    title: 'Live updates are interrupted', badge: 'Last known', tone: 'warning' as const,
    description: 'Showing the most recent state Vela received. Check the Rig again before sending a command.',
  }

  if (view.connectionPreparation.state === 'in-progress') return connectingPresentation

  if (view.rig.state === 'offline') return {
    title: 'This Rig is offline', badge: 'Offline', tone: 'danger' as const,
    description: 'Vela cannot reach the Rig. Check its power and network connection, then check again.',
  }

  switch (view.connectionPreparation.state) {
    case 'available': return {
      title: 'Connect this Rig’s devices', badge: 'Needs connection', tone: 'warning' as const,
      description: 'Vela can reach the Rig. Some supported devices still need to be connected.',
    }
    case 'complete': return {
      title: 'Connection preparation complete', badge: 'Prepared', tone: 'positive' as const,
      description: 'No supported devices need a connection command. Individual device details show what is currently available.',
    }
    default: return {
      title: 'Device state needs attention', badge: 'Needs attention', tone: 'warning' as const,
      description: 'Vela cannot yet confirm the device state needed to offer connection. Check the Rig again for current information.',
    }
  }
}

const connectingPresentation = {
  title: 'Connecting devices…', badge: 'Connecting', tone: 'accent' as const,
  description: 'Vela is waiting for confirmed results. Device status is updating.',
}
