import type { DeviceKind } from '@vela/model/device'
import type {
  RigConnectionDeviceView,
  RigConnectionPreparation,
  RigDetailView,
  RigDeviceDetailView,
  RigObservationView,
} from '@vela/model/web'

const connectableDeviceKinds: ReadonlySet<DeviceKind> = new Set([
  'camera',
  'filter-wheel',
  'focuser',
  'observing-conditions',
  'switch',
  'telescope',
])

export function isConnectableDeviceKind(kind: DeviceKind): boolean {
  return connectableDeviceKinds.has(kind)
}

export function rigObservationView(
  rig: RigDetailView,
  connectionInProgress = false,
): RigObservationView {
  return {
    rig,
    connectionPreparation: connectionPreparation(rig, connectionInProgress),
  }
}

export function connectionDeviceView(
  device: RigDeviceDetailView,
): RigConnectionDeviceView {
  return {
    id: device.id,
    kind: device.kind,
    name: device.name,
  }
}

function connectionPreparation(
  rig: RigDetailView,
  connectionInProgress: boolean,
): RigConnectionPreparation {
  if (connectionInProgress) {
    return { state: 'in-progress', capabilities: [] }
  }

  if (rig.state === 'offline') {
    return { state: 'unavailable', capabilities: [] }
  }

  const connectableDevices = rig.devices.filter((device) =>
    isConnectableDeviceKind(device.kind))

  if (connectableDevices.some((device) => device.connection === 'unavailable')) {
    return { state: 'unavailable', capabilities: [] }
  }

  if (connectableDevices.some((device) => device.connection === 'disconnected')) {
    return { state: 'available', capabilities: ['connect-devices'] }
  }

  return { state: 'complete', capabilities: [] }
}
