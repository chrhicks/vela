import { createAlpacaProvider } from '@vela/alpaca'
import type { EquipmentInspection, InspectDevicesOptions, EquipmentProvider } from '@vela/equipment'
import type { RigEquipmentSource } from '../rig/contracts.js'
import { alpacaEndpoint } from '../equipment/source.js'

export type RigInspectionSource = RigEquipmentSource

export interface RigDeviceInspector {
  inspectDevices(
    options?: InspectDevicesOptions,
  ): Promise<ReadonlyArray<EquipmentInspection>>
}

export interface RigDeviceInspectorOptions {
  readonly provider?: Pick<EquipmentProvider, 'inspectDevices'>
}

export function createRigDeviceInspector(
  rig: RigInspectionSource,
  options: RigDeviceInspectorOptions = {},
): RigDeviceInspector {
  const provider =
    options.provider ??
    createAlpacaProvider({
      baseUrl: alpacaEndpoint(rig),
    })

  return {
    inspectDevices: inspectionOptions => provider.inspectDevices(inspectionOptions),
  }
}
