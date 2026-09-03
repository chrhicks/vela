import { AlpacaProviderError } from './error.js'
import { createAlpacaClient, type AlpacaClient } from './internal/client.js'
import {
  rejectDuplicateDeviceIds,
  stableDeviceId,
} from './internal/configured-device.js'
import { toDeviceKind } from './internal/device-kind.js'
import type { ConfiguredDevice } from './internal/types/management.js'
import type {
  AlpacaCameraActivity,
  AlpacaConnectionStatus,
  AlpacaDevice,
  AlpacaDeviceInspection,
  AlpacaDeviceKind,
  AlpacaDeviceTelemetry,
  AlpacaSwitchChannel,
} from './model.js'

export interface AlpacaProvider {
  listDevices(): Promise<ReadonlyArray<AlpacaDevice>>
  inspectDevices(options?: AlpacaInspectDevicesOptions): Promise<ReadonlyArray<AlpacaDeviceInspection>>
}

export interface AlpacaInspectDevicesOptions {
  readonly signal?: AbortSignal
}

export interface AlpacaProviderOptions {
  baseUrl: string
  fetch?: typeof globalThis.fetch
  requestTimeoutMs?: number
}

const defaultRequestTimeoutMs = 3_000
const maximumSwitchChannels = 256

interface TelemetryRead {
  partial: boolean
}

export function createAlpacaProvider({
  baseUrl,
  fetch = globalThis.fetch,
  requestTimeoutMs = defaultRequestTimeoutMs,
}: AlpacaProviderOptions): AlpacaProvider {
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new RangeError('Provider request timeout must be a positive integer')
  }
  const client = createAlpacaClient({ baseUrl, fetch, requestTimeoutMs })

  async function connection(
    device: ConfiguredDevice,
    signal?: AbortSignal,
  ): Promise<AlpacaConnectionStatus> {
    try {
      return (await client.connected(device, signal)) ? 'connected' : 'disconnected'
    } catch (error) {
      if (signal?.aborted) throw error
      return 'unavailable'
    }
  }

  async function driver(device: ConfiguredDevice): Promise<AlpacaDevice['driver']> {
    let info: string | undefined
    let version: string | undefined

    try {
      info = await client.driverInfo(device)
    } catch {
      // Driver metadata is optional and must not hide an otherwise usable device.
    }

    try {
      version = await client.driverVersion(device)
    } catch {
      // Driver metadata is optional and must not hide an otherwise usable device.
    }

    return {
      ...(info === undefined ? {} : { info }),
      ...(version === undefined ? {} : { version }),
    }
  }

  async function listDevices(): Promise<ReadonlyArray<AlpacaDevice>> {
    const configuredDevices = await client.configuredDevices()
    rejectDuplicateDeviceIds(configuredDevices)
    const devices: AlpacaDevice[] = []

    for (const device of configuredDevices) {
      const providerDeviceId = stableDeviceId(device)
      if (providerDeviceId === undefined) continue

      devices.push({
        providerDeviceId,
        kind: toDeviceKind(device.DeviceType),
        name: device.DeviceName,
        connection: await connection(device),
        driver: await driver(device),
      })
    }

    return devices
  }

  async function inspectDevices({ signal }: AlpacaInspectDevicesOptions = {}): Promise<ReadonlyArray<AlpacaDeviceInspection>> {
    const configuredDevices = await client.configuredDevices(signal)
    rejectDuplicateDeviceIds(configuredDevices)
    const inspections: AlpacaDeviceInspection[] = []

    for (const device of configuredDevices) {
      const providerDeviceId = stableDeviceId(device)
      if (providerDeviceId === undefined) continue

      const kind = toDeviceKind(device.DeviceType)
      const deviceConnection = await connection(device, signal)
      const name = await operationalName(client, device, signal)

      if (deviceConnection !== 'connected') {
        inspections.push({
          providerDeviceId,
          kind,
          configuredName: device.DeviceName,
          name: name ?? device.DeviceName,
          connection: deviceConnection,
          telemetry: { availability: 'unavailable' },
        })
        continue
      }

      if (!supportsTelemetry(kind)) {
        inspections.push({
          providerDeviceId,
          kind,
          configuredName: device.DeviceName,
          name: name ?? device.DeviceName,
          connection: deviceConnection,
          telemetry: { availability: 'unavailable' },
        })
        continue
      }

      const read: TelemetryRead = { partial: false }
      const values = await inspectTelemetry(client, device, kind, read, signal)
      inspections.push({
        providerDeviceId,
        kind,
        configuredName: device.DeviceName,
        name: name ?? device.DeviceName,
        connection: deviceConnection,
        telemetry: {
          availability: read.partial ? 'partial' : 'complete',
          values,
        },
      })
    }

    return inspections
  }

  return { listDevices, inspectDevices }
}

async function operationalName(
  client: AlpacaClient,
  device: ConfiguredDevice,
  signal?: AbortSignal,
): Promise<string | undefined> {
  try {
    const name = (await client.readString(device, 'name', signal)).trim()
    return name.length === 0 ? undefined : name
  } catch (error) {
    if (signal?.aborted) throw error
    return undefined
  }
}

type OptionalReadResult<Value> =
  | { readonly state: 'available'; readonly value: Value }
  | { readonly state: 'unsupported' }
  | { readonly state: 'failed' }

async function optionalReadResult<Value>(
  read: TelemetryRead,
  operation: () => Promise<Value>,
  signal?: AbortSignal,
): Promise<OptionalReadResult<Value>> {
  try {
    return { state: 'available', value: await operation() }
  } catch (error) {
    if (signal?.aborted) throw error
    if (isUnsupported(error)) return { state: 'unsupported' }
    read.partial = true
    return { state: 'failed' }
  }
}

async function optionalRead<Value>(
  read: TelemetryRead,
  operation: () => Promise<Value>,
  signal?: AbortSignal,
): Promise<Value | undefined> {
  const result = await optionalReadResult(read, operation, signal)
  return result.state === 'available' ? result.value : undefined
}

async function requiredRead<Value>(
  read: TelemetryRead,
  operation: () => Promise<Value>,
  signal?: AbortSignal,
): Promise<Value | undefined> {
  try {
    return await operation()
  } catch (error) {
    if (signal?.aborted) throw error
    read.partial = true
    return undefined
  }
}

function isUnsupported(error: unknown): boolean {
  if (!(error instanceof AlpacaProviderError) || error.reason !== 'protocol-error') return false
  if (error.errorNumber === 1024) return true
  return /not implemented|not supported|not present/i.test(error.message)
}

function supportsTelemetry(kind: AlpacaDeviceKind): boolean {
  return kind === 'camera'
    || kind === 'telescope'
    || kind === 'focuser'
    || kind === 'filter-wheel'
    || kind === 'observing-conditions'
    || kind === 'switch'
}

async function inspectTelemetry(
  client: AlpacaClient,
  device: ConfiguredDevice,
  kind: AlpacaDeviceKind,
  read: TelemetryRead,
  signal?: AbortSignal,
): Promise<AlpacaDeviceTelemetry> {
  switch (kind) {
    case 'camera':
      return inspectCamera(client, device, read, signal)
    case 'telescope':
      return inspectTelescope(client, device, read, signal)
    case 'focuser':
      return inspectFocuser(client, device, read, signal)
    case 'filter-wheel':
      return inspectFilterWheel(client, device, read, signal)
    case 'observing-conditions':
      return inspectConditions(client, device, read, signal)
    case 'switch':
      return inspectSwitch(client, device, read, signal)
    default:
      return { kind: 'unknown' }
  }
}

async function inspectCamera(
  client: AlpacaClient,
  device: ConfiguredDevice,
  read: TelemetryRead,
  signal?: AbortSignal,
): Promise<AlpacaDeviceTelemetry> {
  const state = await requiredRead(read, () => client.readNumber(device, 'camerastate', signal), signal)
  const sensorTemperatureC = await optionalRead(read, () => client.readNumber(device, 'ccdtemperature', signal), signal)
  const canSetTemperature = await requiredRead(
    read,
    () => client.readBoolean(device, 'cansetccdtemperature', signal),
    signal,
  )
  const canGetCoolerPower = await requiredRead(
    read,
    () => client.readBoolean(device, 'cangetcoolerpower', signal),
    signal,
  )
  const coolerOn = await optionalRead(
    read,
    () => client.readBoolean(device, 'cooleron', signal),
    signal,
  )
  const reportsCoolingCapability = canSetTemperature === true || canGetCoolerPower === true
  if (sensorTemperatureC === undefined && canSetTemperature === true) read.partial = true
  if (coolerOn === undefined && reportsCoolingCapability) read.partial = true

  const reportedPower = canGetCoolerPower === true
    ? await requiredRead(read, () => client.readNumber(device, 'coolerpower', signal), signal)
    : undefined
  const powerPercent = reportedPower !== undefined
    && reportedPower >= 0
    && reportedPower <= 100
    && (coolerOn !== false || reportedPower === 0)
    ? reportedPower
    : undefined
  if (reportedPower !== undefined && powerPercent === undefined) read.partial = true

  const cooling = coolerOn === undefined
    ? undefined
    : {
        state: coolerOn ? 'on' as const : 'off' as const,
        ...(canSetTemperature === undefined ? {} : { setpointControl: canSetTemperature }),
        ...(canGetCoolerPower === undefined ? {} : { powerReporting: canGetCoolerPower }),
        ...(powerPercent === undefined ? {} : { powerPercent }),
      }

  const activity = cameraActivity(state)
  if (state !== undefined && activity === undefined) read.partial = true
  return {
    kind: 'camera',
    ...(activity === undefined ? {} : { activity }),
    ...(sensorTemperatureC === undefined ? {} : { sensorTemperatureC }),
    ...(cooling === undefined ? {} : { cooling }),
  }
}

function cameraActivity(state: number | undefined): AlpacaCameraActivity | undefined {
  return ['idle', 'waiting', 'exposing', 'reading', 'downloading', 'error'][state ?? -1] as AlpacaCameraActivity | undefined
}

async function inspectTelescope(
  client: AlpacaClient,
  device: ConfiguredDevice,
  read: TelemetryRead,
  signal?: AbortSignal,
): Promise<AlpacaDeviceTelemetry> {
  const parked = await requiredRead(
    read,
    () => client.readBoolean(device, 'atpark', signal),
    signal,
  )
  const atHome = await requiredRead(
    read,
    () => client.readBoolean(device, 'athome', signal),
    signal,
  )
  const slewing = await optionalRead(
    read,
    () => client.readBoolean(device, 'slewing', signal),
    signal,
  )
  const tracking = await requiredRead(
    read,
    () => client.readBoolean(device, 'tracking', signal),
    signal,
  )

  return {
    kind: 'telescope',
    ...(parked === undefined ? {} : { parked }),
    ...(atHome === undefined ? {} : { atHome }),
    ...(slewing === undefined ? {} : { slewing }),
    ...(tracking === undefined ? {} : { tracking }),
  }
}

async function inspectFocuser(
  client: AlpacaClient,
  device: ConfiguredDevice,
  read: TelemetryRead,
  signal?: AbortSignal,
): Promise<AlpacaDeviceTelemetry> {
  const absolute = await requiredRead(
    read,
    () => client.readBoolean(device, 'absolute', signal),
    signal,
  )
  const reportedPosition = absolute === true
    ? await requiredRead(read, () => client.readNumber(device, 'position', signal), signal)
    : undefined
  const maxStep = absolute === true
    ? await requiredRead(read, () => client.readNumber(device, 'maxstep', signal), signal)
    : undefined
  const validPosition = reportedPosition !== undefined
    && maxStep !== undefined
    && Number.isSafeInteger(reportedPosition)
    && Number.isSafeInteger(maxStep)
    && maxStep >= 0
    && reportedPosition >= 0
    && reportedPosition <= maxStep
  const position = validPosition ? reportedPosition : undefined
  if (reportedPosition !== undefined && !validPosition) read.partial = true

  const moving = await requiredRead(
    read,
    () => client.readBoolean(device, 'ismoving', signal),
    signal,
  )
  const temperatureC = await optionalRead(
    read,
    () => client.readNumber(device, 'temperature', signal),
    signal,
  )

  return {
    kind: 'focuser',
    ...(position === undefined ? {} : { position }),
    ...(moving === undefined ? {} : { moving }),
    ...(temperatureC === undefined ? {} : { temperatureC }),
  }
}

async function inspectFilterWheel(
  client: AlpacaClient,
  device: ConfiguredDevice,
  read: TelemetryRead,
  signal?: AbortSignal,
): Promise<AlpacaDeviceTelemetry> {
  const position = await requiredRead(read, () => client.readNumber(device, 'position', signal), signal)
  const names = await requiredRead(read, () => client.readStrings(device, 'names', signal), signal)
  let moving: boolean | undefined
  let selectedPosition: number | undefined

  if (position === -1) {
    moving = true
  } else if (position !== undefined) {
    const validPosition = Number.isSafeInteger(position)
      && position >= 0
      && names !== undefined
      && position < names.length
    if (validPosition) {
      moving = false
      selectedPosition = position
    } else {
      read.partial = true
    }
  }

  const filterName = selectedPosition === undefined ? undefined : names?.[selectedPosition]
  return {
    kind: 'filter-wheel',
    ...(selectedPosition === undefined ? {} : { position: selectedPosition }),
    ...(filterName === undefined ? {} : { filterName }),
    ...(moving === undefined ? {} : { moving }),
  }
}

async function inspectConditions(
  client: AlpacaClient,
  device: ConfiguredDevice,
  read: TelemetryRead,
  signal?: AbortSignal,
): Promise<AlpacaDeviceTelemetry> {
  const temperatureC = await optionalRead(
    read,
    () => client.readNumber(device, 'temperature', signal),
    signal,
  )
  const humidityResult = await optionalReadResult(
    read,
    () => client.readNumber(device, 'humidity', signal),
    signal,
  )
  const humidity = humidityResult.state === 'available' ? humidityResult.value : undefined
  const humidityPercent = humidity !== undefined && humidity >= 0 && humidity <= 100
    ? humidity
    : undefined
  if (humidity !== undefined && humidityPercent === undefined) read.partial = true

  const dewPointResult = await optionalReadResult(
    read,
    () => client.readNumber(device, 'dewpoint', signal),
    signal,
  )
  const dewPointC = dewPointResult.state === 'available' ? dewPointResult.value : undefined
  if (
    (humidityResult.state === 'unsupported' && dewPointResult.state === 'available')
    || (humidityResult.state === 'available' && dewPointResult.state === 'unsupported')
  ) {
    read.partial = true
  }

  return {
    kind: 'observing-conditions',
    ...(temperatureC === undefined ? {} : { temperatureC }),
    ...(humidityPercent === undefined ? {} : { humidityPercent }),
    ...(dewPointC === undefined ? {} : { dewPointC }),
  }
}

async function inspectSwitch(
  client: AlpacaClient,
  device: ConfiguredDevice,
  read: TelemetryRead,
  signal?: AbortSignal,
): Promise<AlpacaDeviceTelemetry> {
  const count = await requiredRead(read, () => client.readNumber(device, 'maxswitch', signal), signal)
  if (
    count === undefined
    || !Number.isSafeInteger(count)
    || count < 0
    || count > maximumSwitchChannels
  ) {
    if (count !== undefined) read.partial = true
    return { kind: 'switch' }
  }

  const channels: AlpacaSwitchChannel[] = []

  for (let id = 0; id < count; id += 1) {
    const suffix = `?Id=${id}`
    const name = await requiredRead(read, () => client.readString(device, `getswitchname${suffix}`, signal), signal)
    const description = await requiredRead(read, () => client.readString(device, `getswitchdescription${suffix}`, signal), signal)
    const value = await requiredRead(read, () => client.readNumber(device, `getswitchvalue${suffix}`, signal), signal)
    const on = await requiredRead(read, () => client.readBoolean(device, `getswitch${suffix}`, signal), signal)
    const minimum = await requiredRead(read, () => client.readNumber(device, `minswitchvalue${suffix}`, signal), signal)
    const maximum = await requiredRead(read, () => client.readNumber(device, `maxswitchvalue${suffix}`, signal), signal)
    const step = await requiredRead(read, () => client.readNumber(device, `switchstep${suffix}`, signal), signal)
    const writable = await requiredRead(read, () => client.readBoolean(device, `canwrite${suffix}`, signal), signal)
    const range = validSwitchRange(value, minimum, maximum, step)
    if (value !== undefined && minimum !== undefined && maximum !== undefined && step !== undefined && range === undefined) {
      read.partial = true
    }
    channels.push({
      id,
      name: name?.trim() || `Switch ${id + 1}`,
      ...(description === undefined ? {} : { description }),
      ...(range === undefined ? {} : range),
      ...(on === undefined ? {} : { on }),
      ...(writable === undefined ? {} : { writable }),
    })
  }
  return { kind: 'switch', channels }
}

function validSwitchRange(
  value: number | undefined,
  minimum: number | undefined,
  maximum: number | undefined,
  step: number | undefined,
): Pick<AlpacaSwitchChannel, 'value' | 'minimum' | 'maximum' | 'step'> | undefined {
  if (value === undefined || minimum === undefined || maximum === undefined || step === undefined) return undefined
  if (maximum <= minimum || step <= 0 || value < minimum || value > maximum) return undefined
  return { value, minimum, maximum, step }
}
