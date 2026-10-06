import type { EquipmentDevice, EquipmentInspection, DeviceConnectionResult } from './inspection.js'

export interface EquipmentInventory {
  listDevices(): Promise<ReadonlyArray<EquipmentDevice>>
}

export interface EquipmentInspector {
  inspectDevices(options?: InspectDevicesOptions): Promise<ReadonlyArray<EquipmentInspection>>
}

export interface EquipmentConnector {
  connectDevice(deviceId: string, options?: ConnectDeviceOptions): Promise<DeviceConnectionResult>
}

export interface EquipmentProvider extends EquipmentInventory, EquipmentInspector, EquipmentConnector {}

export interface InspectDevicesOptions {
  readonly signal?: AbortSignal
}

export interface ConnectDeviceOptions {
  readonly signal?: AbortSignal
}
