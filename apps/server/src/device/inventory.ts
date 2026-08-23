import {
  createAlpacaProvider,
  type AlpacaDevice,
  type AlpacaDeviceKind,
  type AlpacaProvider,
} from '@vela/alpaca'
import type { ConfiguredRig } from '../config/devices.js'
import type { ObservedRigDevice, RigDeviceKind } from './model.js'

export interface RigDeviceInventory {
  listDevices(): Promise<ReadonlyArray<ObservedRigDevice>>
}

export interface RigDeviceInventoryOptions {
  now?: () => Date
  provider?: AlpacaProvider
}

function toRigDeviceKind(kind: AlpacaDeviceKind): RigDeviceKind {
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
  rig: ConfiguredRig,
  device: AlpacaDevice,
  observedAt: Date,
): ObservedRigDevice {
  return {
    id: `${rig.id}-${device.providerDeviceId}`,
    rigId: rig.id,
    kind: toRigDeviceKind(device.kind),
    name: device.name,
    driver: { ...device.driver },
    connection: device.connection,
    status: { state: 'unknown' },
    observedAt,
  }
}

export function createRigDeviceInventory(
  rig: ConfiguredRig,
  options: RigDeviceInventoryOptions = {},
): RigDeviceInventory {
  const now = options.now ?? (() => new Date())
  const provider = options.provider ?? createAlpacaProvider({ baseUrl: rig.url })

  return {
    async listDevices() {
      const devices = await provider.listDevices()
      const observedAt = now()
      return devices.map((device) => toObservedRigDevice(rig, device, observedAt))
    },
  }
}
