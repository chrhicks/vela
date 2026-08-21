import { Schema } from 'effect'
import {
  alpacaResponse,
  boolResponse,
  doubleResponse,
  fromDeviceStateValues,
  intResponse,
  percentDoubleResponse,
  percentIntResponse,
  stringArrayResponse,
  stringResponse,
  timeStamp,
} from './common.js'

export const cameraState = Schema.Literals([0, 1, 2, 3, 4, 5])
export type CameraState = typeof cameraState.Type

export const sensorType = Schema.Literals([0, 1, 2, 3, 4, 5])
export type SensorType = typeof sensorType.Type

export const cameraStateResponse = alpacaResponse(cameraState)
export type CameraStateResponse = typeof cameraStateResponse.Type

export const sensorTypeResponse = alpacaResponse(sensorType)
export type SensorTypeResponse = typeof sensorTypeResponse.Type

export const sensorNameResponse = stringResponse
export const cameraXSizeResponse = intResponse
export const cameraYSizeResponse = intResponse
export const pixelSizeXResponse = doubleResponse
export const pixelSizeYResponse = doubleResponse
export const bayerOffsetXResponse = intResponse
export const bayerOffsetYResponse = intResponse
export const maxBinXResponse = intResponse
export const maxBinYResponse = intResponse
export const binXResponse = intResponse
export const binYResponse = intResponse
export const gainResponse = intResponse
export const gainMinResponse = intResponse
export const gainMaxResponse = intResponse
export const gainsResponse = stringArrayResponse
export const offsetResponse = intResponse
export const offsetMinResponse = intResponse
export const offsetMaxResponse = intResponse
export const offsetsResponse = stringArrayResponse
export const readoutModeResponse = intResponse
export const readoutModesResponse = stringArrayResponse
export const maxAduResponse = intResponse
export const electronsPerAduResponse = doubleResponse
export const fullWellCapacityResponse = doubleResponse
export const hasShutterResponse = boolResponse
export const canSetCcdTemperatureResponse = boolResponse
export const canGetCoolerPowerResponse = boolResponse

export const ccdTemperatureResponse = doubleResponse
export const heatSinkTemperatureResponse = doubleResponse
export const setCcdTemperatureResponse = doubleResponse
export const coolerOnResponse = boolResponse
export const coolerPowerResponse = percentDoubleResponse
export const imageReadyResponse = boolResponse
export const isPulseGuidingResponse = boolResponse
export const percentCompletedResponse = percentIntResponse

export const cameraIdentity = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  sensorName: Schema.optionalKey(Schema.String),
  sensorType: Schema.optionalKey(sensorType),
  cameraXSize: Schema.optionalKey(Schema.Number),
  cameraYSize: Schema.optionalKey(Schema.Number),
  pixelSizeX: Schema.optionalKey(Schema.Number),
  pixelSizeY: Schema.optionalKey(Schema.Number),
  bayerOffsetX: Schema.optionalKey(Schema.Number),
  bayerOffsetY: Schema.optionalKey(Schema.Number),
  maxBinX: Schema.optionalKey(Schema.Number),
  maxBinY: Schema.optionalKey(Schema.Number),
  binX: Schema.optionalKey(Schema.Number),
  binY: Schema.optionalKey(Schema.Number),
  gain: Schema.optionalKey(Schema.Number),
  gainMin: Schema.optionalKey(Schema.Number),
  gainMax: Schema.optionalKey(Schema.Number),
  gains: Schema.optionalKey(Schema.Array(Schema.String)),
  offset: Schema.optionalKey(Schema.Number),
  offsetMin: Schema.optionalKey(Schema.Number),
  offsetMax: Schema.optionalKey(Schema.Number),
  offsets: Schema.optionalKey(Schema.Array(Schema.String)),
  readoutMode: Schema.optionalKey(Schema.Number),
  readoutModes: Schema.optionalKey(Schema.Array(Schema.String)),
  maxAdu: Schema.optionalKey(Schema.Number),
  electronsPerAdu: Schema.optionalKey(Schema.Number),
  fullWellCapacity: Schema.optionalKey(Schema.Number),
  hasShutter: Schema.optionalKey(Schema.Boolean),
  canSetCcdTemperature: Schema.optionalKey(Schema.Boolean),
  canGetCoolerPower: Schema.optionalKey(Schema.Boolean),
})
export type CameraIdentity = typeof cameraIdentity.Type

export const cameraLiveStatus = Schema.Struct({
  cameraState: Schema.optionalKey(cameraState),
  ccdTemperature: Schema.optionalKey(Schema.Number),
  heatSinkTemperature: Schema.optionalKey(Schema.Number),
  setCcdTemperature: Schema.optionalKey(Schema.Number),
  coolerOn: Schema.optionalKey(Schema.Boolean),
  coolerPower: Schema.optionalKey(Schema.Number),
  imageReady: Schema.optionalKey(Schema.Boolean),
  isPulseGuiding: Schema.optionalKey(Schema.Boolean),
  percentCompleted: Schema.optionalKey(Schema.Number),
})
export type CameraLiveStatus = typeof cameraLiveStatus.Type

export const cameraDeviceState = fromDeviceStateValues({
  CameraState: Schema.optionalKey(cameraState),
  CCDTemperature: Schema.optionalKey(Schema.Number),
  CoolerPower: Schema.optionalKey(Schema.Number),
  HeatSinkTemperature: Schema.optionalKey(Schema.Number),
  ImageReady: Schema.optionalKey(Schema.Boolean),
  IsPulseGuiding: Schema.optionalKey(Schema.Boolean),
  PercentCompleted: Schema.optionalKey(Schema.Number),
  TimeStamp: timeStamp,
})
export type CameraDeviceState = typeof cameraDeviceState.Type
