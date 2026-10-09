import { createAlpacaProvider } from '@vela/alpaca'
import type { EquipmentDevice, DeviceKind, EquipmentProvider } from '@vela/equipment'
import type { RigEquipmentSource } from '../rig/contracts.js'
import { alpacaEndpoint } from '../equipment/source.js'
import type { ObservedRigDevice, RigDeviceKind } from './model.js'

export type RigInventorySource = RigEquipmentSource

export interface RigDeviceInventory {
  listDevices(): Promise<ReadonlyArray<ObservedRigDevice>>
}

export interface RigDeviceInventoryOptions {
  now?: () => Date
  provider?: Pick<EquipmentProvider, 'listDevices'>
}

function toRigDeviceKind(kind: DeviceKind): RigDeviceKind {
  switch (kind) {
    case 'camera':
    case 'cover-calibrator':
    case 'dome':
    case 'filter-wheel':
    case 'focuser':
    case 'observing-conditions':
    case 'rotator':
    case 'safety-monitor':
    case 'switch':
    case 'telescope':
    case 'unknown':
      return kind
  }
}

function toObservedRigDevice(
  rig: RigInventorySource,
  device: EquipmentDevice,
  observedAt: Date,
): ObservedRigDevice {
  const observed: ObservedRigDevice = {
    id: `${rig.id}-${device.providerDeviceId}`,
    rigId: rig.id,
    uniqueId: device.providerDeviceId,
    kind: toRigDeviceKind(device.kind),
    name: device.name,
    driver: { ...device.driver },
    connection: device.connection,
    status: { state: 'unknown' },
    observedAt: device.observation?.observedAt ? new Date(device.observation.observedAt) : observedAt,
  }

  if (device.observation) observed.observation = device.observation

  return observed
}

export function createRigDeviceInventory(
  rig: RigInventorySource,
  options: RigDeviceInventoryOptions = {},
): RigDeviceInventory {
  const now = options.now ?? (() => new Date())

  const provider =
    options.provider ??
    createAlpacaProvider({
      baseUrl: alpacaEndpoint(rig),
    })

  return {
    async listDevices() {
      const devices = await provider.listDevices()
      const observedAt = now()

      return devices.map(device => toObservedRigDevice(rig, device, observedAt))
    },
  }
}
