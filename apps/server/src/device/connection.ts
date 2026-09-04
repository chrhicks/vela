import {
  createAlpacaProvider,
  type AlpacaConnectDeviceOptions,
  type AlpacaDeviceConnectionResult,
  type AlpacaProvider,
} from '@vela/alpaca'
import type { RigEndpoint, RigId } from '@vela/model/rig'

export interface RigConnectionSource {
  readonly id: RigId
  readonly endpoint: RigEndpoint
}

export interface RigDeviceConnector {
  connectDevice(
    providerDeviceId: string,
    options?: AlpacaConnectDeviceOptions,
  ): Promise<AlpacaDeviceConnectionResult>
}

export interface RigDeviceConnectorOptions {
  readonly provider?: Pick<AlpacaProvider, 'connectDevice'>
}

export function createRigDeviceConnector(
  rig: RigConnectionSource,
  options: RigDeviceConnectorOptions = {},
): RigDeviceConnector {
  const provider = options.provider ?? createAlpacaProvider({
    baseUrl: `http://${rig.endpoint.host}:${rig.endpoint.port}`,
  })

  return {
    connectDevice: (providerDeviceId, connectionOptions) =>
      provider.connectDevice(providerDeviceId, connectionOptions),
  }
}
