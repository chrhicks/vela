import type { DeviceSummary } from '@vela/model/device'
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
