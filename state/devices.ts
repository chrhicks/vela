import { Result, Schema } from 'effect'
import { Limits, MalformedReading, PropertyState, type StreamPosition } from './entry.ts'
import type { Readings } from './readings.ts'

const property = <Values extends Schema.Top>(values: Values) =>
  Schema.optionalKey(
    Schema.Struct({
      state: Schema.optionalKey(PropertyState),
      values,
      limits: Schema.optionalKey(Schema.Record(Schema.String, Limits)),
      at: Schema.Number,
    }),
  )

const Connection = property(Schema.Struct({ CONNECT: Schema.Boolean, DISCONNECT: Schema.Boolean }))

export const Mount = Schema.Struct({
  CONNECTION: Connection,
  EQUATORIAL_EOD_COORD: property(Schema.Struct({ RA: Schema.Number, DEC: Schema.Number })),
  TELESCOPE_TRACK_STATE: property(Schema.Struct({ TRACK_ON: Schema.Boolean, TRACK_OFF: Schema.Boolean })),
  TELESCOPE_PIER_SIDE: property(Schema.Struct({ PIER_WEST: Schema.Boolean, PIER_EAST: Schema.Boolean })),
  TELESCOPE_PARK: property(Schema.Struct({ PARK: Schema.Boolean, UNPARK: Schema.Boolean })),
  TELESCOPE_HOME: property(Schema.Struct({ GO: Schema.Boolean })),
  TELESCOPE_MOTION_NS: property(Schema.Struct({ MOTION_NORTH: Schema.Boolean, MOTION_SOUTH: Schema.Boolean })),
  TELESCOPE_MOTION_WE: property(Schema.Struct({ MOTION_WEST: Schema.Boolean, MOTION_EAST: Schema.Boolean })),
  MERIDIAN_LIMIT: property(Schema.Struct({ LIMIT: Schema.Number })),
  GEOGRAPHIC_COORD: property(Schema.Struct({ LAT: Schema.Number, LONG: Schema.Number, ELEV: Schema.Number })),
  TIME_UTC: property(Schema.Struct({ UTC: Schema.String, OFFSET: Schema.String })),
  DEBUG: property(Schema.Struct({ ENABLE: Schema.Boolean, DISABLE: Schema.Boolean })),
  DEBUG_LEVEL: property(Schema.Record(Schema.String, Schema.Boolean)),
})

export type Mount = typeof Mount.Type

export const Primary = Schema.Struct({
  CONNECTION: Connection,
  CCD_TEMPERATURE: property(Schema.Struct({ CCD_TEMPERATURE_VALUE: Schema.Number })),
  CCD_COOLER: property(Schema.Struct({ COOLER_ON: Schema.Boolean, COOLER_OFF: Schema.Boolean })),
  CCD_COOLER_POWER: property(Schema.Struct({ CCD_COOLER_VALUE: Schema.Number })),
  CCD_CONTROLS: property(Schema.Struct({ Gain: Schema.Number, Offset: Schema.Number })),
  UPLOAD_MODE: property(Schema.Struct({ UPLOAD_CLIENT: Schema.Boolean, UPLOAD_LOCAL: Schema.Boolean, UPLOAD_BOTH: Schema.Boolean })),
  SCOPE_INFO: property(Schema.Struct({ FOCAL_LENGTH: Schema.Number, APERTURE: Schema.Number })),
})

export type Primary = typeof Primary.Type

export const Focuser = Schema.Struct({
  CONNECTION: Connection,
  ABS_FOCUS_POSITION: property(Schema.Struct({ FOCUS_ABSOLUTE_POSITION: Schema.Number })),
  FOCUS_TEMPERATURE: property(Schema.Struct({ TEMPERATURE: Schema.Number })),
})

export type Focuser = typeof Focuser.Type

export const Box = Schema.Struct({
  CONNECTION: Connection,
  DEW_CHANNELS: property(Schema.Record(Schema.String, Schema.Boolean)),
  DEW_DUTY_CYCLES: property(Schema.Record(Schema.String, Schema.Number)),
  DEW_LABELS: property(Schema.Record(Schema.String, Schema.String)),
  AUTO_DEW_CONTROL: property(Schema.Record(Schema.String, Schema.Boolean)),
  WEATHER_PARAMETERS: property(Schema.Struct({ WEATHER_TEMPERATURE: Schema.Number, WEATHER_HUMIDITY: Schema.Number, WEATHER_DEWPOINT: Schema.Number })),
})

export type Box = typeof Box.Type

export const Guide = Schema.Struct({
  CONNECTION: Connection,
})

export type Guide = typeof Guide.Type

export const Devices = Schema.Struct({
  mount: Mount,
  primary: Primary,
  focuser: Focuser,
  box: Box,
  guide: Guide,
})

export type Devices = typeof Devices.Type

export const DeviceName = Schema.Literals(['mount', 'primary', 'focuser', 'box', 'guide'])

export type DeviceName = typeof DeviceName.Type

export const deviceNames = DeviceName.literals

export const deviceProperties: Readonly<Record<DeviceName, ReadonlyArray<string>>> = {
  mount: Object.keys(Mount.fields),
  primary: Object.keys(Primary.fields),
  focuser: Object.keys(Focuser.fields),
  box: Object.keys(Box.fields),
  guide: Object.keys(Guide.fields),
}

export const noDevices: Devices = { mount: {}, primary: {}, focuser: {}, box: {}, guide: {} }

const decoders = {
  mount: Schema.decodeUnknownResult(Mount),
  primary: Schema.decodeUnknownResult(Primary),
  focuser: Schema.decodeUnknownResult(Focuser),
  box: Schema.decodeUnknownResult(Box),
  guide: Schema.decodeUnknownResult(Guide),
}

export function devices(state: Devices, before: Readings, after: Readings, seq: StreamPosition): Result.Result<Devices, MalformedReading> {
  if (before === after) return Result.succeed(state)

  let next = state

  for (const name of deviceNames) {
    if (before[name] === after[name]) continue

    const decoded = decoders[name](after[name] ?? {})

    if (Result.isFailure(decoded)) return Result.fail(new MalformedReading({ seq, issue: `${name}: ${decoded.failure.message}` }))

    next = { ...next, [name]: decoded.success }
  }

  return Result.succeed(next)
}

export type MountActivity = 'parked' | 'homing' | 'slewing' | 'moving' | 'tracking' | 'idle'

export function mountActivity(mount: Mount): MountActivity | undefined {
  if (Object.keys(mount).length === 0) return undefined
  if (mount.TELESCOPE_PARK?.values.PARK === true) return 'parked'
  if (mount.TELESCOPE_HOME?.state === 'Busy') return 'homing'
  if (mount.EQUATORIAL_EOD_COORD?.state === 'Busy') return 'slewing'
  if (mount.TELESCOPE_MOTION_NS?.state === 'Busy' || mount.TELESCOPE_MOTION_WE?.state === 'Busy') return 'moving'
  if (mount.TELESCOPE_TRACK_STATE?.values.TRACK_ON === true) return 'tracking'

  return 'idle'
}

export const sensorCelsius = (primary: Primary) => primary.CCD_TEMPERATURE?.values.CCD_TEMPERATURE_VALUE

export const focusPosition = (focuser: Focuser) => focuser.ABS_FOCUS_POSITION?.values.FOCUS_ABSOLUTE_POSITION

export interface DewHeater {
  readonly channel: string
  readonly label: string
  readonly percent: number
  readonly on: boolean
  readonly auto: boolean
}

export function dewHeaters(box: Box): ReadonlyArray<DewHeater> {
  const duty = box.DEW_DUTY_CYCLES?.values ?? {}
  const labels = box.DEW_LABELS?.values ?? {}
  const on = box.DEW_CHANNELS?.values ?? {}
  const auto = box.AUTO_DEW_CONTROL?.values ?? {}

  return Object.entries(duty)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([channel, percent]) => ({ channel, label: labels[channel] || channel, percent, on: on[channel] !== false, auto: auto[channel] === true }))
}
