import {
  createAlpacaProvider,
  type AlpacaDeviceInspection,
  type AlpacaInspectDevicesOptions,
  type AlpacaProvider,
} from '@vela/alpaca'
import type { RigEndpoint, RigId } from '@vela/model/rig'

export interface RigInspectionSource {
  readonly id: RigId
  readonly endpoint: RigEndpoint
}

export interface RigDeviceInspector {
  inspectDevices(
    options?: AlpacaInspectDevicesOptions,
  ): Promise<ReadonlyArray<AlpacaDeviceInspection>>
}

export interface RigDeviceInspectorOptions {
  readonly provider?: Pick<AlpacaProvider, 'inspectDevices'>
}

export function createRigDeviceInspector(
  rig: RigInspectionSource,
  options: RigDeviceInspectorOptions = {},
): RigDeviceInspector {
  const provider =
    options.provider ??
    createAlpacaProvider({
      baseUrl: `http://${rig.endpoint.host}:${rig.endpoint.port}`,
    })

  return {
    inspectDevices: inspectionOptions => provider.inspectDevices(inspectionOptions),
  }
}
