import { Schema } from 'effect'
import { alpacaResponse } from './common.js'

export const configuredDevice = Schema.Struct({
  DeviceName: Schema.String,
  DeviceType: Schema.String,
  DeviceNumber: Schema.Number,
  UniqueID: Schema.optionalKey(Schema.String),
})
export type ConfiguredDevice = typeof configuredDevice.Type

export const configuredDevicesResponse = alpacaResponse(Schema.Array(configuredDevice))
export type ConfiguredDevicesResponse = typeof configuredDevicesResponse.Type

export const serverDescription = Schema.Struct({
  ServerName: Schema.optionalKey(Schema.String),
  Manufacturer: Schema.optionalKey(Schema.String),
  ManufacturerVersion: Schema.optionalKey(Schema.String),
  Location: Schema.optionalKey(Schema.String),
})
export type ServerDescription = typeof serverDescription.Type
