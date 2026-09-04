import type { RigConnectionDeviceView, RigObservationView } from '@vela/model/web'

export function observation(state: 'available' | 'complete' | 'unavailable' | 'in-progress' = 'available', id = 'rig-1'): RigObservationView {
  const now = '2026-09-04T20:00:00.000Z'
  const connected = state === 'complete'
  return {
    rig: {
      id, name: id === 'rig-2' ? 'Askar FRA 400' : 'Seestar S30', state: 'reachable',
      endpoint: { host: 'alpaca.local', port: 11111 },
      addedAt: now, lastInventoryAt: now, refreshedAt: now,
      connections: { total: 3, connected: connected ? 3 : 0, disconnected: connected ? 0 : 3, unavailable: 0 },
      capabilities: ['forget'],
      devices: ['camera', 'focuser', 'telescope'].map((kind, index) => ({
        id: `${id}-${index}`, name: ['Main camera', 'Focuser', 'Mount'][index]!, configuredName: kind,
        kind: kind as 'camera' | 'focuser' | 'telescope',
        observedAt: now,
        ...(connected
          ? { connection: 'connected' as const, status: { availability: 'unsupported' as const } }
          : { connection: 'disconnected' as const, status: { availability: 'unavailable' as const } }),
      })),
    },
    connectionPreparation: state === 'available'
      ? { state, capabilities: ['connect-devices'] }
      : { state, capabilities: [] },
  }
}

export function device(index: number): RigConnectionDeviceView {
  const { id, kind, name } = observation().rig.devices[index]!
  return { id, kind, name }
}

export function offlineObservation() {
  const view = observation('unavailable')
  return {
    ...view,
    rig: {
      ...view.rig, state: 'offline',
      connections: { total: 3, connected: 0, disconnected: 0, unavailable: 3 },
      devices: view.rig.devices.map((item) => ({ ...item, connection: 'unavailable' })),
    },
  }
}
