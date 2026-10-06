import { createAlpacaProvider } from '@vela/alpaca'
import type { ConnectDeviceOptions, DeviceConnectionResult, EquipmentProvider } from '@vela/equipment'
import type { RigEquipmentSource } from '../rig/contracts.js'
import { alpacaEndpoint } from '../equipment/source.js'

export type RigConnectionSource = RigEquipmentSource

export interface RigDeviceConnector {
  connectDevice(
    providerDeviceId: string,
    options?: ConnectDeviceOptions,
  ): Promise<DeviceConnectionResult>
}

export interface RigDeviceConnectorOptions {
  readonly provider?: Pick<EquipmentProvider, 'connectDevice'>
}

export function createRigDeviceConnector(
  rig: RigConnectionSource,
  options: RigDeviceConnectorOptions = {},
): RigDeviceConnector {
  const provider =
    options.provider ??
    createAlpacaProvider({
      baseUrl: alpacaEndpoint(rig),
    })

  return {
    connectDevice: (providerDeviceId, connectionOptions) =>
      provider.connectDevice(providerDeviceId, connectionOptions),
  }
}
