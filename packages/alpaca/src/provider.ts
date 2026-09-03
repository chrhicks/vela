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
          telemetry: { availability: deviceConnection === 'unavailable' ? 'unavailable' : 'complete' },
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

async function optionalRead<Value>(
  read: TelemetryRead,
  operation: () => Promise<Value>,
  signal?: AbortSignal,
): Promise<Value | undefined> {
  try {
    return await operation()
  } catch (error) {
    if (signal?.aborted) throw error
    if (!isUnsupported(error)) read.partial = true
    return undefined
  }
}

function isUnsupported(error: unknown): boolean {
  if (!(error instanceof AlpacaProviderError) || error.reason !== 'protocol-error') return false
  if (error.errorNumber === 1024) return true
  return /not implemented|not supported|not present/i.test(error.message)
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
  const state = await optionalRead(read, () => client.readNumber(device, 'camerastate', signal), signal)
  const sensorTemperatureC = await optionalRead(read, () => client.readNumber(device, 'ccdtemperature', signal), signal)
  const canCool = await optionalRead(read, () => client.readBoolean(device, 'cansetccdtemperature', signal), signal)
  let cooling: { state: 'on' | 'off'; powerPercent?: number } | undefined

  if (canCool) {
    const coolerOn = await optionalRead(read, () => client.readBoolean(device, 'cooleron', signal), signal)
    if (coolerOn !== undefined) {
      const powerPercent = coolerOn
        ? await optionalRead(read, () => client.readNumber(device, 'coolerpower', signal), signal)
        : undefined
      cooling = {
        state: coolerOn ? 'on' : 'off',
        ...(powerPercent === undefined ? {} : { powerPercent }),
      }
    }
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
  const parked = await optionalRead(
    read,
    () => client.readBoolean(device, 'atpark', signal),
    signal,
  )
  const atHome = await optionalRead(
    read,
    () => client.readBoolean(device, 'athome', signal),
    signal,
  )
  const slewing = await optionalRead(
    read,
    () => client.readBoolean(device, 'slewing', signal),
    signal,
  )
  const tracking = await optionalRead(
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
  const position = await optionalRead(
    read,
    () => client.readNumber(device, 'position', signal),
    signal,
  )
  const moving = await optionalRead(
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
  const position = await optionalRead(read, () => client.readNumber(device, 'position', signal), signal)
  const names = await optionalRead(read, () => client.readStrings(device, 'names', signal), signal)
  const moving = position === -1
  const selectedPosition = position === undefined || moving ? undefined : position
  const filterName = selectedPosition === undefined ? undefined : names?.[selectedPosition]
  return {
    kind: 'filter-wheel',
    ...(selectedPosition === undefined ? {} : { position: selectedPosition }),
    ...(filterName === undefined ? {} : { filterName }),
    ...(position === undefined ? {} : { moving }),
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
  const humidityPercent = await optionalRead(
    read,
    () => client.readNumber(device, 'humidity', signal),
    signal,
  )
  const dewPointC = await optionalRead(
    read,
    () => client.readNumber(device, 'dewpoint', signal),
    signal,
  )

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
  const count = await optionalRead(read, () => client.readNumber(device, 'maxswitch', signal), signal)
  const channels: AlpacaSwitchChannel[] = []
  if (
    count === undefined
    || !Number.isSafeInteger(count)
    || count < 0
    || count > maximumSwitchChannels
  ) {
    if (count !== undefined) read.partial = true
    return { kind: 'switch', channels }
  }

  for (let id = 0; id < count; id += 1) {
    const suffix = `?Id=${id}`
    const name = await optionalRead(read, () => client.readString(device, `getswitchname${suffix}`, signal), signal)
    const description = await optionalRead(read, () => client.readString(device, `getswitchdescription${suffix}`, signal), signal)
    const value = await optionalRead(read, () => client.readNumber(device, `getswitchvalue${suffix}`, signal), signal)
    const enabled = await optionalRead(read, () => client.readBoolean(device, `getswitch${suffix}`, signal), signal)
    const minimum = await optionalRead(read, () => client.readNumber(device, `minswitchvalue${suffix}`, signal), signal)
    const maximum = await optionalRead(read, () => client.readNumber(device, `maxswitchvalue${suffix}`, signal), signal)
    const step = await optionalRead(read, () => client.readNumber(device, `switchstep${suffix}`, signal), signal)
    const writable = await optionalRead(read, () => client.readBoolean(device, `canwrite${suffix}`, signal), signal)
    channels.push({
      id,
      name: name?.trim() || `Switch ${id + 1}`,
      ...(description === undefined ? {} : { description }),
      ...(value === undefined ? {} : { value }),
      ...(enabled === undefined ? {} : { enabled }),
      ...(minimum === undefined ? {} : { minimum }),
      ...(maximum === undefined ? {} : { maximum }),
      ...(step === undefined ? {} : { step }),
      ...(writable === undefined ? {} : { writable }),
    })
  }
  return { kind: 'switch', channels }
}
