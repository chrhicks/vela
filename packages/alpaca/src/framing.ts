import { setTimeout as delay } from 'node:timers/promises'
import { AlpacaProviderError } from './error.js'
import { createAlpacaClient } from './internal/client.js'
import { rejectDuplicateDeviceIds, stableDeviceId } from './internal/configured-device.js'
import type { ConfiguredDevice } from './internal/types/management.js'

const trackingRates = ['sidereal', 'lunar', 'solar', 'king'] as const
const coordinateSystems = ['other', 'topocentric', 'j2000', 'j2050', 'b1950'] as const
export type AlpacaCoordinateSystem = typeof coordinateSystems[number] | 'unknown'

export interface AlpacaCameraGeometry {
  cameraName: string
  sensorWidthPixels: number
  sensorHeightPixels: number
  pixelWidthMicrons: number
  pixelHeightMicrons: number
  binX: number
  binY: number
  /** Image dimensions and origin are in binned pixels. */
  width: number
  height: number
  startX: number
  startY: number
}

export interface AlpacaTelescopeStatus {
  rightAscensionDegrees: number
  declinationDegrees: number
  coordinateSystem: AlpacaCoordinateSystem
  latitudeDegrees?: number
  /** East-positive longitude. */
  longitudeDegrees?: number
  elevationMeters?: number
  tracking: boolean
  trackingRate?: typeof trackingRates[number]
  /** Offset from sidereal, in seconds of RA per sidereal second. */
  rightAscensionRateSecondsPerSiderealSecond?: number
  /** Offset from zero declination motion, in arcseconds per SI second. */
  declinationRateArcsecondsPerSecond?: number
  /** ASCOM pointing state: east is normal, west is through the pole. */
  pierSide?: 'east' | 'west' | 'unknown'
  slewing: boolean
  parked: boolean
  observedAt: string
}

export interface AlpacaSlewOptions {
  telescopeId: string
  rightAscensionDegrees: number
  declinationDegrees: number
  /** Coordinates must already be expressed in the driver's reported frame. */
  coordinateSystem: AlpacaCoordinateSystem
}

export interface AlpacaFramingOptions {
  baseUrl: string
  fetch?: typeof globalThis.fetch
  requestTimeoutMs?: number
  slewTimeoutMs?: number
  pollIntervalMs?: number
}

export interface AlpacaFraming {
  cameraGeometry(options: { cameraId: string; expectedCameraName?: string }, signal?: AbortSignal): Promise<AlpacaCameraGeometry>
  telescopeStatus(telescopeId: string, signal?: AbortSignal, options?: { includeAlignmentObservations?: boolean }): Promise<AlpacaTelescopeStatus>
  setTracking(telescopeId: string, tracking: boolean, signal?: AbortSignal): Promise<void>
  slew(options: AlpacaSlewOptions, signal?: AbortSignal): Promise<void>
  abortTelescope(telescopeId: string): Promise<void>
}

export class AlpacaFramingStoppedError extends Error {
  constructor() {
    super('Telescope slew cancellation confirmed')
    this.name = 'AbortError'
  }
}

function invalid(message: string, endpoint: string): never {
  throw new AlpacaProviderError(message, { reason: 'invalid-response', endpoint })
}

function validateNumber(value: number, minimum: number, maximum: number, endpoint: string, integer = false) {
  if (!Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
    invalid(`Invalid ${endpoint}`, endpoint)
  }
  return value
}

function unsupported(error: unknown) {
  return error instanceof AlpacaProviderError && error.reason === 'protocol-error' && error.errorNumber === 1024
}

export function createAlpacaFraming({ baseUrl, fetch = globalThis.fetch, requestTimeoutMs = 5_000, slewTimeoutMs = 180_000, pollIntervalMs = 200 }: AlpacaFramingOptions): AlpacaFraming {
  for (const value of [requestTimeoutMs, slewTimeoutMs, pollIntervalMs]) {
    if (!Number.isInteger(value) || value <= 0) throw new RangeError('Framing timeouts and poll interval must be positive integers')
  }
  const client = createAlpacaClient({ baseUrl, fetch, requestTimeoutMs })

  async function device(id: string, kind: string, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const devices = await client.configuredDevices(signal)
    rejectDuplicateDeviceIds(devices)
    const found = devices.find(candidate => stableDeviceId(candidate) === id && candidate.DeviceType.toLowerCase() === kind)
    if (!found) throw new Error(`Configured ${kind} ${id} was not found`)
    if (!(await client.connected(found, signal))) throw new Error(`${kind} is disconnected`)
    return found
  }

  async function frame(telescope: ConfiguredDevice, signal?: AbortSignal): Promise<AlpacaCoordinateSystem> {
    let value: number
    try { value = await client.readNumber(telescope, 'equatorialsystem', signal) }
    catch (error) { if (unsupported(error)) return 'unknown'; throw error }
    const result = coordinateSystems[value]
    if (!Number.isInteger(value) || result === undefined) invalid('Invalid equatorial coordinate system', 'equatorialsystem')
    return result
  }

  async function optionalNumber(telescope: ConfiguredDevice, property: string, minimum: number, maximum: number, signal?: AbortSignal) {
    try { return validateNumber(await client.readNumber(telescope, property, signal), minimum, maximum, property) }
    catch (error) { if (unsupported(error)) return undefined; throw error }
  }

  async function waitStopped(telescope: ConfiguredDevice, signal: AbortSignal) {
    while (true) {
      signal.throwIfAborted()
      if (!(await client.connected(telescope, signal))) throw new Error('Telescope disconnected before stop could be confirmed')
      if (!(await client.readBoolean(telescope, 'slewing', signal))) return
      await delay(pollIntervalMs, undefined, { signal })
    }
  }

  async function stop(telescope: ConfiguredDevice) {
    const signal = AbortSignal.timeout(Math.min(slewTimeoutMs, 15_000))
    let commandError: unknown
    try { await client.command(telescope, 'abortslew', {}, signal) }
    catch (error) { commandError = error }
    try { await waitStopped(telescope, signal) }
    catch (error) {
      throw new AggregateError(commandError === undefined ? [error] : [commandError, error], 'Telescope stop could not be confirmed')
    }
  }

  return {
    async cameraGeometry({ cameraId, expectedCameraName }, signal) {
      if (expectedCameraName !== undefined && !expectedCameraName.trim()) throw new RangeError('Expected camera name must not be blank')
      const camera = await device(cameraId, 'camera', signal)
      const cameraName = (await client.readString(camera, 'name', signal)).trim()
      if (!cameraName) invalid('Camera returned a blank operational name', 'name')
      if (expectedCameraName !== undefined && cameraName !== expectedCameraName.trim()) throw new Error('The camera in this driver slot has changed; select the imaging camera again')
      const number = async (property: string, minimum = 1, integer = true) => validateNumber(await client.readNumber(camera, property, signal), minimum, 2147483647, property, integer)
      const sensorWidthPixels = await number('cameraxsize')
      const sensorHeightPixels = await number('cameraysize')
      const pixelWidthMicrons = await number('pixelsizex', Number.MIN_VALUE, false)
      const pixelHeightMicrons = await number('pixelsizey', Number.MIN_VALUE, false)
      const binX = await number('binx')
      const binY = await number('biny')
      const width = await number('numx')
      const height = await number('numy')
      const startX = await number('startx', 0)
      const startY = await number('starty', 0)
      if ((startX + width) * binX > sensorWidthPixels || (startY + height) * binY > sensorHeightPixels) invalid('Camera subframe exceeds the sensor', 'numx/numy/startx/starty')
      return { cameraName, sensorWidthPixels, sensorHeightPixels, pixelWidthMicrons, pixelHeightMicrons, binX, binY, width, height, startX, startY }
    },

    async telescopeStatus(telescopeId, signal, options) {
      const telescope = await device(telescopeId, 'telescope', signal)
      const ra = validateNumber(await client.readNumber(telescope, 'rightascension', signal), 0, 24, 'rightascension')
      if (ra === 24) invalid('Right ascension must be less than 24 hours', 'rightascension')
      const declinationDegrees = validateNumber(await client.readNumber(telescope, 'declination', signal), -90, 90, 'declination')
      const coordinateSystem = await frame(telescope, signal)
      const latitudeDegrees = await optionalNumber(telescope, 'sitelatitude', -90, 90, signal)
      const longitudeDegrees = await optionalNumber(telescope, 'sitelongitude', -180, 180, signal)
      const elevationMeters = await optionalNumber(telescope, 'siteelevation', -300, 10000, signal)
      const tracking = await client.readBoolean(telescope, 'tracking', signal)
      const slewing = await client.readBoolean(telescope, 'slewing', signal)
      const parked = await client.readBoolean(telescope, 'atpark', signal)
      const alignment: Partial<AlpacaTelescopeStatus> = {}
      if (options?.includeAlignmentObservations) {
        const rate = await optionalNumber(telescope, 'trackingrate', 0, 3, signal)
        if (rate !== undefined) {
          if (!Number.isInteger(rate)) invalid('Invalid trackingrate', 'trackingrate')
          alignment.trackingRate = trackingRates[rate]!
        }
        const raRate = await optionalNumber(telescope, 'rightascensionrate', -Infinity, Infinity, signal)
        if (raRate !== undefined) alignment.rightAscensionRateSecondsPerSiderealSecond = raRate
        const decRate = await optionalNumber(telescope, 'declinationrate', -Infinity, Infinity, signal)
        if (decRate !== undefined) alignment.declinationRateArcsecondsPerSecond = decRate
        const side = await optionalNumber(telescope, 'sideofpier', -1, 1, signal)
        if (side !== undefined) {
          if (!Number.isInteger(side)) invalid('Invalid sideofpier', 'sideofpier')
          alignment.pierSide = side === -1 ? 'unknown' : side === 0 ? 'east' : 'west'
        }
      }
      return { ...alignment, rightAscensionDegrees: ra * 15, declinationDegrees, coordinateSystem, ...(latitudeDegrees === undefined ? {} : { latitudeDegrees }), ...(longitudeDegrees === undefined ? {} : { longitudeDegrees }), ...(elevationMeters === undefined ? {} : { elevationMeters }), tracking, slewing, parked, observedAt: new Date().toISOString() }
    },

    async setTracking(telescopeId, tracking, signal) {
      if (typeof tracking !== 'boolean') throw new RangeError('Tracking must be boolean')
      const telescope = await device(telescopeId, 'telescope', signal)
      if (await client.readBoolean(telescope, 'tracking', signal) === tracking) return
      if (await client.readBoolean(telescope, 'atpark', signal)) throw new Error('Telescope is parked')
      if (await client.readBoolean(telescope, 'slewing', signal)) throw new Error('Telescope is already moving')
      if (!(await client.readBoolean(telescope, 'cansettracking', signal))) throw new Error('Telescope cannot change tracking')
      signal?.throwIfAborted()
      let commandError: unknown
      try { await client.command(telescope, 'tracking', { Tracking: String(tracking) }, signal) }
      catch (error) { commandError = error }
      // A lost setter response is resolved by observing the requested state,
      // never by replaying the write. Caller cancellation cannot cancel inspection.
      const confirmation = AbortSignal.timeout(requestTimeoutMs)
      const commandDetail = commandError instanceof Error ? ` Setter reported: ${commandError.message}.` : ''
      try {
        while (true) {
          if (!(await client.connected(telescope, confirmation))) throw new Error('Telescope disconnected during tracking confirmation')
          if (await client.readBoolean(telescope, 'tracking', confirmation) === tracking) break
          // A decoded rejection is stronger evidence than a delayed state read.
          if (commandError instanceof AlpacaProviderError && commandError.reason === 'protocol-error' && commandError.errorNumber !== undefined) {
            throw new Error('The telescope rejected the tracking change')
          }
          await delay(pollIntervalMs, undefined, { signal: confirmation })
        }
      } catch (error) {
        const detail = confirmation.aborted ? 'Requested tracking state was not observed before the confirmation deadline'
          : error instanceof Error ? error.message : 'Tracking state inspection failed'
        throw new Error(`Telescope tracking change was not confirmed. ${detail}.${commandDetail}`, { cause: error })
      }
      signal?.throwIfAborted()
    },

    async slew({ telescopeId, rightAscensionDegrees, declinationDegrees, coordinateSystem }, signal) {
      if (!Number.isFinite(rightAscensionDegrees) || rightAscensionDegrees < 0 || rightAscensionDegrees >= 360 || !Number.isFinite(declinationDegrees) || Math.abs(declinationDegrees) > 90) throw new RangeError('Invalid slew coordinates')
      if (!coordinateSystems.includes(coordinateSystem as typeof coordinateSystems[number]) || coordinateSystem === 'other') throw new Error('Slew requires a supported, explicit coordinate frame')
      const telescope = await device(telescopeId, 'telescope', signal)
      if (await frame(telescope, signal) !== coordinateSystem) throw new Error('Slew coordinates do not match the telescope coordinate frame')
      if (await client.readBoolean(telescope, 'atpark', signal)) throw new Error('Telescope is parked')
      if (await client.readBoolean(telescope, 'slewing', signal)) throw new Error('Telescope is already moving')
      if (!(await client.readBoolean(telescope, 'canslewasync', signal))) throw new Error('Telescope cannot slew asynchronously')
      if (!(await client.readBoolean(telescope, 'tracking', signal))) throw new Error('Equatorial slew requires tracking')
      signal?.throwIfAborted()
      const deadline = AbortSignal.timeout(slewTimeoutMs)
      const operationSignal = signal ? AbortSignal.any([signal, deadline]) : deadline
      try {
        await client.command(telescope, 'slewtocoordinatesasync', { RightAscension: String(rightAscensionDegrees / 15), Declination: String(declinationDegrees) }, operationSignal)
        await waitStopped(telescope, operationSignal)
      } catch (error) {
        // Any attempted write can leave physical movement behind, even when
        // HTTP is cancelled. Independently stop and inspect; never replay it.
        await stop(telescope)
        if (signal?.aborted) throw new AlpacaFramingStoppedError()
        throw error
      }
    },

    async abortTelescope(telescopeId) {
      await stop(await device(telescopeId, 'telescope'))
    },
  }
}
