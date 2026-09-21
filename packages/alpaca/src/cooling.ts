import { AlpacaProviderError } from './error.js'
import { createAlpacaClient, type AlpacaClient } from './internal/client.js'
import { rejectDuplicateDeviceIds, stableDeviceId } from './internal/configured-device.js'
import type { ConfiguredDevice } from './internal/types/management.js'

/** Confirmed camera cooling facts. Sensor temperature is never a substitute for CoolerOn. */
export interface CameraCoolingObservation {
  readonly state: 'on' | 'off'
  readonly canSetTemperature: boolean
  readonly canGetPower: boolean
  readonly sensorTemperatureC?: number
  readonly setpointC?: number
  readonly powerPercent?: number
}

export type CameraCoolingCommandResult =
  | {
      readonly outcome: 'confirmed'
      readonly observation: CameraCoolingObservation
    }
  | {
      readonly outcome: 'failed'
      readonly reason: 'device-not-found' | 'disconnected' | 'unsupported' | 'rejected' | 'not-confirmed'
      readonly message?: string
      readonly errorNumber?: number
    }
  | {
      readonly outcome: 'uncertain'
      readonly reason: 'cancelled' | 'write-outcome-unknown' | 'verification-unavailable'
    }

export interface CameraCoolingCommand {
  readonly cameraId: string
  readonly expectedCameraName?: string
  readonly coolerOn?: boolean
  readonly setpointC?: number
  readonly signal?: AbortSignal
}

export interface AlpacaCameraCoolingOptions {
  readonly baseUrl: string
  readonly fetch?: typeof globalThis.fetch
  readonly requestTimeoutMs?: number
}

export interface AlpacaCameraCooling {
  observe(cameraId: string, signal?: AbortSignal): Promise<CameraCoolingObservation | undefined>
  setCooling(command: CameraCoolingCommand): Promise<CameraCoolingCommandResult>
}

const setpointToleranceC = 0.15

export function createAlpacaCameraCooling({
  baseUrl,
  fetch = globalThis.fetch,
  requestTimeoutMs = 5_000,
}: AlpacaCameraCoolingOptions): AlpacaCameraCooling {
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new RangeError('Cooling request timeout must be a positive integer')
  }

  const client = createAlpacaClient({ baseUrl, fetch, requestTimeoutMs })

  async function camera(cameraId: string, signal?: AbortSignal): Promise<ConfiguredDevice | undefined> {
    signal?.throwIfAborted()
    const devices = await client.configuredDevices(signal)
    rejectDuplicateDeviceIds(devices)

    return devices.find(candidate => stableDeviceId(candidate) === cameraId && candidate.DeviceType.toLowerCase() === 'camera')
  }

  async function observe(cameraId: string, signal?: AbortSignal): Promise<CameraCoolingObservation | undefined> {
    const device = await camera(cameraId, signal)

    if (!device) return undefined

    if (!(await client.connected(device, signal))) return undefined

    return readObservation(client, device, signal)
  }

  async function setCooling(command: CameraCoolingCommand): Promise<CameraCoolingCommandResult> {
    const { cameraId, expectedCameraName, coolerOn, setpointC, signal } = command

    if (coolerOn === undefined && setpointC === undefined) {
      throw new RangeError('A cooling command must request cooler state, temperature, or both')
    }

    if (setpointC !== undefined && !Number.isFinite(setpointC)) {
      throw new RangeError('Requested temperature must be a finite number')
    }

    try {
      signal?.throwIfAborted()
      const device = await camera(cameraId, signal)

      if (!device) return { outcome: 'failed', reason: 'device-not-found' }

      if (!(await client.connected(device, signal))) return { outcome: 'failed', reason: 'disconnected' }

      if (expectedCameraName !== undefined) {
        const name = await client.readString(device, 'name', signal)

        if (name.trim() !== expectedCameraName) {
          return {
            outcome: 'failed',
            reason: 'not-confirmed',
            message: 'Camera identity changed or is unavailable.',
          }
        }
      }

      const capabilities = await readCapabilities(client, device, signal)

      if (setpointC !== undefined && !capabilities.canSetTemperature) {
        return {
          outcome: 'failed',
          reason: 'unsupported',
          message: 'This camera does not accept a target temperature.',
        }
      }

      if (coolerOn !== undefined && !capabilities.coolerReadable) {
        return {
          outcome: 'failed',
          reason: 'unsupported',
          message: 'This camera does not report cooler on or off.',
        }
      }

      if (setpointC !== undefined) {
        const written = await writeAndVerify(
          device,
          () => client.command(device, 'setccdtemperature', { SetCCDTemperature: String(setpointC) }, signal),
          () => client.readNumber(device, 'setccdtemperature', signal),
          confirmed => Math.abs(confirmed - setpointC) <= setpointToleranceC,
          signal,
        )

        if (written.outcome !== 'confirmed') return written
      }

      if (coolerOn !== undefined) {
        const written = await writeAndVerify(
          device,
          () => client.command(device, 'cooleron', { CoolerOn: String(coolerOn) }, signal),
          () => client.readBoolean(device, 'cooleron', signal),
          confirmed => confirmed === coolerOn,
          signal,
        )

        if (written.outcome !== 'confirmed') return written
      }

      const observation = await readObservation(client, device, signal)

      if (!observation) return {
        outcome: 'failed',
        reason: 'not-confirmed',
        message: 'The camera did not report cooler state after the command.',
      }

      if (coolerOn !== undefined && observation.state !== (coolerOn ? 'on' : 'off')) {
        return {
          outcome: 'failed',
          reason: 'not-confirmed',
          message: 'The camera did not confirm the requested cooler state.',
        }
      }

      if (setpointC !== undefined && (observation.setpointC === undefined || Math.abs(observation.setpointC - setpointC) > setpointToleranceC)) {
        return {
          outcome: 'failed',
          reason: 'not-confirmed',
          message: 'The camera did not confirm the requested temperature.',
        }
      }

      return { outcome: 'confirmed', observation }
    } catch (error) {
      if (signal?.aborted) return { outcome: 'uncertain', reason: 'cancelled' }

      if (error instanceof AlpacaProviderError && error.reason === 'protocol-error' && error.errorNumber !== undefined) {
        return {
          outcome: 'failed',
          reason: 'rejected',
          message: error.message,
          errorNumber: error.errorNumber,
        }
      }

      throw error
    }
  }

  return { observe, setCooling }
}

async function writeAndVerify<Value>(
  _device: ConfiguredDevice,
  write: () => Promise<void>,
  read: () => Promise<Value>,
  confirmed: (value: Value) => boolean,
  signal?: AbortSignal,
): Promise<Extract<CameraCoolingCommandResult, { outcome: 'confirmed' }> | Exclude<CameraCoolingCommandResult, { outcome: 'confirmed' }>> {
  let writeOutcomeUnknown = false

  try {
    await write()
  } catch (error) {
    if (error instanceof AlpacaProviderError && error.reason === 'protocol-error' && error.errorNumber !== undefined) {
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

  try {
    const value = await read()

    if (confirmed(value)) return {
      outcome: 'confirmed',
      observation: { state: 'off', canSetTemperature: false, canGetPower: false },
    }

    return writeOutcomeUnknown
      ? { outcome: 'uncertain', reason: 'write-outcome-unknown' }
      : { outcome: 'failed', reason: 'not-confirmed' }
  } catch {
    if (signal?.aborted) return { outcome: 'uncertain', reason: 'cancelled' }

    return writeOutcomeUnknown
      ? { outcome: 'uncertain', reason: 'write-outcome-unknown' }
      : { outcome: 'uncertain', reason: 'verification-unavailable' }
  }
}

interface CoolingCapabilities {
  readonly canSetTemperature: boolean
  readonly coolerReadable: boolean
}

async function readCapabilities(
  client: AlpacaClient,
  device: ConfiguredDevice,
  signal?: AbortSignal,
): Promise<CoolingCapabilities> {
  const canSetTemperature = await optionalBoolean(client, device, 'cansetccdtemperature', signal) === true
  const coolerOn = await optionalBoolean(client, device, 'cooleron', signal)

  return {
    canSetTemperature,
    coolerReadable: coolerOn !== undefined,
  }
}

type Mutable<Value> = { -readonly [Key in keyof Value]: Value[Key] }

async function readObservation(
  client: AlpacaClient,
  device: ConfiguredDevice,
  signal?: AbortSignal,
): Promise<CameraCoolingObservation | undefined> {
  const canSetTemperature = await optionalBoolean(client, device, 'cansetccdtemperature', signal) === true
  const canGetPower = await optionalBoolean(client, device, 'cangetcoolerpower', signal) === true
  const coolerOn = await optionalBoolean(client, device, 'cooleron', signal)

  if (coolerOn === undefined) return undefined

  const observation: Mutable<CameraCoolingObservation> = {
    state: coolerOn ? 'on' : 'off',
    canSetTemperature,
    canGetPower,
  }

  const sensorTemperatureC = await optionalNumber(client, device, 'ccdtemperature', signal)

  if (sensorTemperatureC !== undefined) observation.sensorTemperatureC = sensorTemperatureC

  if (canSetTemperature) {
    const setpointC = await optionalNumber(client, device, 'setccdtemperature', signal)

    if (setpointC !== undefined) observation.setpointC = setpointC
  }

  if (canGetPower) {
    const powerPercent = await optionalNumber(client, device, 'coolerpower', signal)

    if (powerPercent !== undefined && powerPercent >= 0 && powerPercent <= 100 && (coolerOn || powerPercent === 0)) {
      observation.powerPercent = powerPercent
    }
  }

  return observation
}

async function optionalBoolean(
  client: AlpacaClient,
  device: ConfiguredDevice,
  operation: string,
  signal?: AbortSignal,
): Promise<boolean | undefined> {
  try {
    return await client.readBoolean(device, operation, signal)
  } catch (error) {
    if (signal?.aborted) throw error

    if (isUnsupported(error)) return undefined
    throw error
  }
}

async function optionalNumber(
  client: AlpacaClient,
  device: ConfiguredDevice,
  operation: string,
  signal?: AbortSignal,
): Promise<number | undefined> {
  try {
    return await client.readNumber(device, operation, signal)
  } catch (error) {
    if (signal?.aborted) throw error

    if (isUnsupported(error)) return undefined
    throw error
  }
}

function isUnsupported(error: unknown): error is AlpacaProviderError {
  if (!(error instanceof AlpacaProviderError) || error.reason !== 'protocol-error') return false

  if (error.errorNumber === 1024) return true

  return /not implemented|not supported|not present/i.test(error.message)
}
