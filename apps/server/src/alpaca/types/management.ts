import { Schema } from 'effect';

export const configuredDevice = Schema.Struct({
  DeviceName: Schema.String,
  DeviceType: Schema.String,
  DeviceNumber: Schema.Number,
  UniqueID: Schema.String,
})
export type ConfiguredDevice = typeof configuredDevice.Type

export const configuredDevicesResponse = Schema.Struct({
  Value: Schema.Array(configuredDevice),
})
export type ConfiguredDevicesResponse = typeof configuredDevicesResponse.Type
