import { AlpacaProviderError } from './error.js'
import { createAlpacaClient, type AlpacaClient } from './internal/client.js'
import {
  normalizeConfiguredDevices,
  rejectDuplicateDeviceIds,
  rejectMissingDeviceIds,
  stableDeviceId,
} from './internal/configured-device.js'
import { toDeviceKind } from './internal/device-kind.js'
import type { ConfiguredDevice } from './internal/types/management.js'
import type {
  AlpacaCameraActivity,
  AlpacaConnectionStatus,
  AlpacaDevice,
  AlpacaDeviceConnectionResult,
  AlpacaDeviceInspection,
  AlpacaDeviceKind,
  AlpacaDeviceTelemetry,
  AlpacaSwitchChannel,
} from './model.js'

export interface AlpacaProvider {
  listDevices(): Promise<ReadonlyArray<AlpacaDevice>>
  inspectDevices(options?: AlpacaInspectDevicesOptions): Promise<ReadonlyArray<AlpacaDeviceInspection>>
  connectDevice(providerDeviceId: string, options?: AlpacaConnectDeviceOptions): Promise<AlpacaDeviceConnectionResult>
}

export interface AlpacaInspectDevicesOptions {
  readonly signal?: AbortSignal
}

export interface AlpacaConnectDeviceOptions {
  readonly signal?: AbortSignal
}

export interface AlpacaProviderOptions {
  baseUrl: string
  fetch?: typeof globalThis.fetch
  requestTimeoutMs?: number
  connectionPollIntervalMs?: number
  connectionVerificationTimeoutMs?: number
}

const defaultRequestTimeoutMs = 3_000

const defaultConnectionPollIntervalMs = 250

const defaultConnectionVerificationTimeoutMs = 30_000

const maximumSwitchChannels = 256

type Mutable<Value> = { -readonly [Key in keyof Value]: Value[Key] }

interface TelemetryRead {
  partial: boolean
}

export function createAlpacaProvider({
  baseUrl,
  fetch = globalThis.fetch,
  requestTimeoutMs = defaultRequestTimeoutMs,
  connectionPollIntervalMs = defaultConnectionPollIntervalMs,
  connectionVerificationTimeoutMs = defaultConnectionVerificationTimeoutMs,
}: AlpacaProviderOptions): AlpacaProvider {
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new RangeError('Provider request timeout must be a positive integer')
  }

  if (!Number.isInteger(connectionPollIntervalMs) || connectionPollIntervalMs <= 0) {
    throw new RangeError('Connection poll interval must be a positive integer')
  }

  if (!Number.isInteger(connectionVerificationTimeoutMs) || connectionVerificationTimeoutMs <= 0) {
    throw new RangeError('Connection verification timeout must be a positive integer')
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

    const metadata: AlpacaDevice['driver'] = {}

    if (info !== undefined) metadata.info = info

    if (version !== undefined) metadata.version = version

    return metadata
  }

  async function listDevices(): Promise<ReadonlyArray<AlpacaDevice>> {
    const configuredDevices = normalizeConfiguredDevices(
      await client.configuredDevices(),
    )

    rejectMissingDeviceIds(configuredDevices)
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
    const configuredDevices = normalizeConfiguredDevices(
      await client.configuredDevices(signal),
    )

    rejectMissingDeviceIds(configuredDevices)
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

  async function connectDevice(
    providerDeviceId: string,
    { signal }: AlpacaConnectDeviceOptions = {},
  ): Promise<AlpacaDeviceConnectionResult> {
    signal?.throwIfAborted()

    const configuredDevices = normalizeConfiguredDevices(
      await client.configuredDevices(signal),
    )

    rejectMissingDeviceIds(configuredDevices)
    rejectDuplicateDeviceIds(configuredDevices)
    const device = configuredDevices.find((candidate) => stableDeviceId(candidate) === providerDeviceId)

    if (device === undefined) {
      return { outcome: 'failed', reason: 'device-not-found' }
    }

    if (await client.connected(device, signal)) {
      return { outcome: 'connected', command: 'not-needed' }
    }

    signal?.throwIfAborted()
    let writeOutcomeUnknown = false

    try {
      await client.setConnected(device, signal)
    } catch (error) {
      if (
        error instanceof AlpacaProviderError
        && error.reason === 'protocol-error'
        && error.errorNumber !== undefined
      ) {
        return {
          outcome: 'failed',
          reason: 'rejected',
          message: error.message,
          errorNumber: error.errorNumber,
        }
      }

      if (signal?.aborted) return { outcome: 'uncertain', reason: 'cancelled' }
      writeOutcomeUnknown = true
    }

    return verifyConnection(device, writeOutcomeUnknown, signal)
  }

  async function verifyConnection(
    device: ConfiguredDevice,
    writeOutcomeUnknown: boolean,
    signal?: AbortSignal,
  ): Promise<AlpacaDeviceConnectionResult> {
    try {
      if (await client.connected(device, signal)) {
        return { outcome: 'connected', command: 'requested' }
      }
    } catch {
      return verificationFailure(signal)
    }

    let connecting: boolean

    try {
      connecting = await client.connecting(device, signal)
    } catch (error) {
      if (signal?.aborted) return { outcome: 'uncertain', reason: 'cancelled' }

      if (isUnsupported(error)) {
        return writeOutcomeUnknown
          ? { outcome: 'uncertain', reason: 'write-outcome-unknown' }
          : { outcome: 'failed', reason: 'remained-disconnected' }
      }

      return { outcome: 'uncertain', reason: 'verification-unavailable' }
    }

    if (!connecting) {
      return writeOutcomeUnknown
        ? { outcome: 'uncertain', reason: 'write-outcome-unknown' }
        : { outcome: 'failed', reason: 'remained-disconnected' }
    }

    const deadline = Date.now() + connectionVerificationTimeoutMs

    while (connecting) {
      const remainingMs = deadline - Date.now()

      if (remainingMs <= 0) return { outcome: 'uncertain', reason: 'verification-timeout' }

      try {
        await wait(Math.min(connectionPollIntervalMs, remainingMs), signal)
        connecting = await client.connecting(device, signal)
      } catch {
        return verificationFailure(signal)
      }
    }

    try {
      return (await client.connected(device, signal))
        ? { outcome: 'connected', command: 'requested' }
        : { outcome: 'failed', reason: 'remained-disconnected' }
    } catch {
      return verificationFailure(signal)
    }
  }

  return { listDevices, inspectDevices, connectDevice }
}

function verificationFailure(signal?: AbortSignal): AlpacaDeviceConnectionResult {
  return signal?.aborted
    ? { outcome: 'uncertain', reason: 'cancelled' }
    : { outcome: 'uncertain', reason: 'verification-unavailable' }
}

function wait(durationMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)

      return
    }

    const onAbort = () => {
      clearTimeout(timeout)
      reject(signal?.reason)
    }

    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, durationMs)

    signal?.addEventListener('abort', onAbort, { once: true })
  })
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

function isUnsupported(error: unknown): error is AlpacaProviderError {
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

  const setpointC = canSetTemperature === true
    ? await requiredRead(read, () => client.readNumber(device, 'setccdtemperature', signal), signal)
    : undefined

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

  let cooling: Mutable<NonNullable<Extract<AlpacaDeviceTelemetry, { kind: 'camera' }>['cooling']>> | undefined

  if (coolerOn !== undefined) {
    cooling = { state: coolerOn ? 'on' : 'off' }

    if (canSetTemperature !== undefined) cooling.setpointControl = canSetTemperature

    if (canGetCoolerPower !== undefined) cooling.powerReporting = canGetCoolerPower

    if (setpointC !== undefined) cooling.setpointC = setpointC

    if (powerPercent !== undefined) cooling.powerPercent = powerPercent
  }

  const activity = cameraActivity(state)

  if (state !== undefined && activity === undefined) read.partial = true

  const telemetry: Mutable<Extract<AlpacaDeviceTelemetry, { kind: 'camera' }>> = { kind: 'camera' }

  if (activity !== undefined) telemetry.activity = activity

  if (sensorTemperatureC !== undefined) telemetry.sensorTemperatureC = sensorTemperatureC

  if (cooling !== undefined) telemetry.cooling = cooling

  return telemetry
}

function cameraActivity(state: number | undefined): AlpacaCameraActivity | undefined {
  const activities = ['idle', 'waiting', 'exposing', 'reading', 'downloading', 'error'] as const

  return activities[state ?? -1]
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

  const normalized = normalizeTelescopeState({ parked, atHome, slewing, tracking })

  if (normalized.partial) read.partial = true

  const telemetry: Mutable<Extract<AlpacaDeviceTelemetry, { kind: 'telescope' }>> = { kind: 'telescope' }

  if (normalized.parked !== undefined) telemetry.parked = normalized.parked

  if (normalized.atHome !== undefined) telemetry.atHome = normalized.atHome

  if (normalized.slewing !== undefined) telemetry.slewing = normalized.slewing

  if (normalized.tracking !== undefined) telemetry.tracking = normalized.tracking

  return telemetry
}

interface TelescopeState {
  readonly parked: boolean | undefined
  readonly atHome: boolean | undefined
  readonly slewing: boolean | undefined
  readonly tracking: boolean | undefined
}

function normalizeTelescopeState(state: TelescopeState): TelescopeState & { readonly partial: boolean } {
  const invalid = new Set<keyof TelescopeState>()

  if (state.parked === true && state.tracking === true) {
    invalid.add('parked')
    invalid.add('tracking')
  }

  if (state.parked === true && state.slewing === true) {
    invalid.add('parked')
    invalid.add('slewing')
  }

  if (state.atHome === true && state.slewing === true) {
    invalid.add('atHome')
    invalid.add('slewing')
  }

  if (state.atHome === true && state.tracking === true) {
    invalid.add('atHome')
    invalid.add('tracking')
  }

  return {
    parked: invalid.has('parked') ? undefined : state.parked,
    atHome: invalid.has('atHome') ? undefined : state.atHome,
    slewing: invalid.has('slewing') ? undefined : state.slewing,
    tracking: invalid.has('tracking') ? undefined : state.tracking,
    partial: invalid.size > 0,
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

  const telemetry: Mutable<Extract<AlpacaDeviceTelemetry, { kind: 'focuser' }>> = { kind: 'focuser' }

  if (position !== undefined) telemetry.position = position

  if (moving !== undefined) telemetry.moving = moving

  if (temperatureC !== undefined) telemetry.temperatureC = temperatureC

  return telemetry
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

  const telemetry: Mutable<Extract<AlpacaDeviceTelemetry, { kind: 'filter-wheel' }>> = { kind: 'filter-wheel' }

  if (selectedPosition !== undefined) telemetry.position = selectedPosition

  if (filterName !== undefined) telemetry.filterName = filterName

  if (moving !== undefined) telemetry.moving = moving

  return telemetry
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

  const telemetry: Mutable<Extract<AlpacaDeviceTelemetry, { kind: 'observing-conditions' }>> = { kind: 'observing-conditions' }

  if (temperatureC !== undefined) telemetry.temperatureC = temperatureC

  if (humidityPercent !== undefined) telemetry.humidityPercent = humidityPercent

  if (dewPointC !== undefined) telemetry.dewPointC = dewPointC

  return telemetry
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

    const contradictoryState = range !== undefined
      && on !== undefined
      && on !== (range.value !== range.minimum)

    if (contradictoryState) read.partial = true

    const channel: Mutable<AlpacaSwitchChannel> = {
      id,
      name: name?.trim() || `Switch ${id + 1}`,
    }

    if (description !== undefined) channel.description = description

    if (range !== undefined) {
      channel.minimum = range.minimum
      channel.maximum = range.maximum
      channel.step = range.step

      if (!contradictoryState) channel.value = range.value
    }

    if (on !== undefined && !contradictoryState) channel.on = on

    if (writable !== undefined) channel.writable = writable
    channels.push(channel)
  }

  return { kind: 'switch', channels }
}

function validSwitchRange(
  value: number | undefined,
  minimum: number | undefined,
  maximum: number | undefined,
  step: number | undefined,
): Required<Pick<AlpacaSwitchChannel, 'value' | 'minimum' | 'maximum' | 'step'>> | undefined {
  if (value === undefined || minimum === undefined || maximum === undefined || step === undefined) return undefined

  if (maximum <= minimum || step <= 0 || value < minimum || value > maximum) return undefined

  return { value, minimum, maximum, step }
}
