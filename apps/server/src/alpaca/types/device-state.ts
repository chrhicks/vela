import { Schema } from 'effect';
import { fromDeviceStateValues, timeStamp } from './common.js';

export const focuserState = fromDeviceStateValues({
  IsMoving: Schema.optionalKey(Schema.Boolean),
  Position: Schema.optionalKey(Schema.Number),
  Temperature: Schema.optionalKey(Schema.Number),
  TimeStamp: timeStamp,
})
export type FocuserState = typeof focuserState.Type

export const observingConditionsState = fromDeviceStateValues({
  CloudCover: Schema.optionalKey(Schema.Number),
  DewPoint: Schema.optionalKey(Schema.Number),
  Humidity: Schema.optionalKey(Schema.Number),
  Pressure: Schema.optionalKey(Schema.Number),
  RainRate: Schema.optionalKey(Schema.Number),
  SkyBrightness: Schema.optionalKey(Schema.Number),
  SkyQuality: Schema.optionalKey(Schema.Number),
  SkyTemperature: Schema.optionalKey(Schema.Number),
  StarFWHM: Schema.optionalKey(Schema.Number),
  Temperature: Schema.optionalKey(Schema.Number),
  WindDirection: Schema.optionalKey(Schema.Number),
  WindGust: Schema.optionalKey(Schema.Number),
  WindSpeed: Schema.optionalKey(Schema.Number),
  TimeStamp: timeStamp,
})
export type ObservingConditionsState = typeof observingConditionsState.Type

export const telescopeState = fromDeviceStateValues({
  Altitude: Schema.optionalKey(Schema.Number),
  AtHome: Schema.optionalKey(Schema.Boolean),
  AtPark: Schema.optionalKey(Schema.Boolean),
  Azimuth: Schema.optionalKey(Schema.Number),
  Declination: Schema.optionalKey(Schema.Number),
  IsPulseGuiding: Schema.optionalKey(Schema.Boolean),
  RightAscension: Schema.optionalKey(Schema.Number),
  SideOfPier: Schema.optionalKey(Schema.Number),
  SiderealTime: Schema.optionalKey(Schema.Number),
  Slewing: Schema.optionalKey(Schema.Boolean),
  Tracking: Schema.optionalKey(Schema.Boolean),
  UTCDate: Schema.optionalKey(Schema.String),
  TimeStamp: timeStamp,
})
export type TelescopeState = typeof telescopeState.Type
