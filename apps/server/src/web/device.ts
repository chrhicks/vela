import type { ConnectionStatus, DeviceSummary } from '@vela/model/device'
import type { RigDeviceConnectionSummary } from '@vela/model/rig'
import type { ObservedRigDevice } from '../device/model.js'

export function toDeviceSummary(device: ObservedRigDevice): DeviceSummary {
  return {
    id: device.id,
    rigId: device.rigId,
    kind: device.kind,
    name: device.name,
    driver: { ...device.driver },
    connection: device.connection,
    status: { ...device.status },
    updatedAt: device.observedAt.toISOString(),
  }
}

export function summarizeDeviceConnections(
  devices: ReadonlyArray<{ readonly connection: ConnectionStatus }>,
): RigDeviceConnectionSummary {
  let connected = 0
  let disconnected = 0
  let unavailable = 0

  for (const device of devices) {
    switch (device.connection) {
      case 'connected':
        connected += 1
        break
      case 'disconnected':
        disconnected += 1
        break
      case 'unavailable':
        unavailable += 1
        break
    }
  }

  return {
    total: devices.length,
    connected,
    disconnected,
    unavailable,
  }
}
