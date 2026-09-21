import { Schema } from 'effect'
import { setTimeout as delay } from 'node:timers/promises'
import { SpanStatusCode, trace } from '@opentelemetry/api'
import { AlpacaProviderError } from './error.js'
import { imageBytesPixels } from './internal/image-bytes.js'
import { createAlpacaClient, type CameraImage } from './internal/client.js'
import type { ConfiguredDevice } from './internal/types/management.js'
import { rejectDuplicateDeviceIds, stableDeviceId } from './internal/configured-device.js'

export class AlpacaCaptureStoppedError extends Error {
  constructor() {
    super('Exposure cancellation confirmed')
    this.name = 'AbortError'
  }
}

/** A fresh capture may be attempted: no exposure started, or an acknowledged
 * exposure was stopped and the camera confirmed idle. Never an uncertain write. */
export class AlpacaCaptureRetryableError extends Error {
  constructor(cause: AlpacaProviderError) {
    super(cause.message, { cause })
    this.name = 'AlpacaCaptureRetryableError'
  }
}

export type AlpacaFrameColor =
  | { kind: 'mono' }
  | { kind: 'bayer'; pattern: 'rggb' | 'grbg' | 'gbrg' | 'bggr' }

export interface AlpacaFrame {
  width: number
  height: number
  /** Row-major, pixels[y * width + x]. */
  pixels: Float64Array
  capturedAt: string
  /** Missing means a camera-supplied timestamp (including older callers). */
  capturedAtSource?: 'camera' | 'server-estimate'
  /** Color layout at the returned image origin, after accounting for subframe position. */
  color: AlpacaFrameColor
}

export interface AlpacaCaptureOptions {
  cameraId: string
  /** Confirm the operational camera name when a driver slot can host different hardware. */
  expectedCameraName?: string
  exposureSeconds: number
  /** Reject color before starting when the consumer requires monochrome samples. */
  monochromeOnly?: boolean
  signal?: AbortSignal
  onProgress?: (elapsedSeconds: number) => void
  onReadout?: () => void
  /** Observation of this acknowledged exposure is interrupted; no new exposure is started. */
  onReadState?: (state: 'retrying' | 'current') => void
}

export interface AlpacaAcquisitionOptions {
  baseUrl: string
  fetch?: typeof globalThis.fetch
  requestTimeoutMs?: number
  imageTimeoutMs?: number
  readRetryIntervalMs?: number
}

const coordinateSystems = ['other', 'topocentric', 'j2000', 'j2050', 'b1950'] as const

export interface AlpacaPointing {
  rightAscensionDegrees: number
  declinationDegrees: number
  siderealTimeDegrees: number
  latitudeDegrees: number
  tracking: boolean
  coordinateSystem: typeof coordinateSystems[number]
}

export interface AlpacaAcquisition {
  capture(options: AlpacaCaptureOptions): Promise<AlpacaFrame>
  pointing(telescopeId: string, signal?: AbortSignal): Promise<AlpacaPointing>
  move(
    telescopeId: string,
    rateDegreesPerSecond: number,
    durationSeconds: number,
    signal?: AbortSignal,
  ): Promise<void>
  /** Rotate the primary axis until observed RA reaches the signed angular travel. */
  rotateRightAscension(
    telescopeId: string,
    rateDegreesPerSecond: number,
    distanceDegrees: number,
    signal?: AbortSignal,
  ): Promise<void>
  abort(cameraId: string, telescopeId: string): Promise<void>
}

function invalid(message: string, endpoint: string): never {
  throw new AlpacaProviderError(message, { reason: 'invalid-response', endpoint })
}

function bounded(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw new RangeError(`Invalid ${label}`)

  return value
}

function decodeFrame(
  raw: CameraImage,
  width: number,
  height: number,
  capturedAt: string,
  color: AlpacaFrameColor,
): AlpacaFrame {
  const endpoint = 'imagearray'

  if (raw instanceof ArrayBuffer) return {
    width,
    height,
    pixels: imageBytesPixels(raw, width, height),
    capturedAt,
    color,
  }

  const image = raw

  if (!Array.isArray(image.Value) || image.Value.length !== width)
    invalid('Image width differs from exposure dimensions', endpoint)
  const pixels = new Float64Array(width * height)

  for (let x = 0; x < width; x++) {
    const column = image.Value[x]

    if (!Array.isArray(column) || column.length !== height)
      invalid('Image has inconsistent column dimensions', endpoint)

    for (let y = 0; y < height; y++) {
      const value = column[y]!

      pixels[y * width + x] = value
    }
  }

  return { width, height, pixels, capturedAt, color }
}

export function createAlpacaAcquisition({
  baseUrl,
  fetch = globalThis.fetch,
  requestTimeoutMs = 5_000,
  imageTimeoutMs = 60_000,
  readRetryIntervalMs = 1_000,
}: AlpacaAcquisitionOptions): AlpacaAcquisition {
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs <= 0)
    throw new RangeError('Invalid request timeout')

  if (!Number.isInteger(imageTimeoutMs) || imageTimeoutMs <= 0) throw new RangeError('Invalid image timeout')

  if (!Number.isInteger(readRetryIntervalMs) || readRetryIntervalMs <= 0)
    throw new RangeError('Invalid read retry interval')
  const client = createAlpacaClient({ baseUrl, fetch, requestTimeoutMs, imageTimeoutMs })

  async function device(id: string, kind: string, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const devices = await client.configuredDevices(signal)
    rejectDuplicateDeviceIds(devices)

    const found = devices.find(candidate =>
      stableDeviceId(candidate) === id && candidate.DeviceType.toLowerCase() === kind)

    if (!found) throw new Error(`Configured ${kind} ${id} was not found`)

    return found
  }

  async function stopTelescope(telescope: ConfiguredDevice) {
    // Cleanup is independent of the caller's cancellation. Never replay motion.
    const span = trace.getActiveSpan()
    span?.addEvent('alpaca.stop.requested')
    await client.command(telescope, 'moveaxis', { Axis: '0', Rate: '0' })
    span?.addEvent('alpaca.stop.acknowledged')
    const confirmation = AbortSignal.timeout(5_000)

    try {
      while (await client.readBoolean(telescope, 'slewing', confirmation)) {
        await delay(100, undefined, { signal: confirmation })
      }

      span?.addEvent('alpaca.stop.confirmed')
    } catch (error) {
      if (confirmation.aborted)
        throw new Error('Telescope did not confirm movement stopped within 5 seconds')
      throw error
    }
  }

  async function stopCamera(camera: ConfiguredDevice) {
    await client.command(camera, 'abortexposure', {})

    if (await client.readNumber(camera, 'camerastate') !== 0)
      throw new Error('Camera did not confirm exposure stopped')
  }

  async function primaryAxis(telescopeId: string, rate: number, signal?: AbortSignal) {
    bounded(rate, -10, 10, 'axis rate')
    const telescope = await device(telescopeId, 'telescope', signal)

    if (!(await client.connected(telescope, signal))) throw new Error('Telescope is disconnected')

    if (!(await client.readBoolean(telescope, 'canmoveaxis?Axis=0', signal)))
      throw new Error('Telescope cannot move its primary axis')

    if (await client.readBoolean(telescope, 'slewing', signal)) throw new Error('Telescope is already moving')

    const ranges = await client.readValue(
      telescope,
      'axisrates?Axis=0',
      Schema.Array(Schema.Struct({ Minimum: Schema.Finite, Maximum: Schema.Finite })),
      signal,
    )

    if (ranges.some(range => range.Minimum < 0 || range.Maximum < range.Minimum))
      invalid('Invalid axis rate ranges', 'axisrates')

    if (rate !== 0 && !ranges.some(range => Math.abs(rate) >= range.Minimum && Math.abs(rate) <= range.Maximum))
      throw new Error('Requested rate is not supported by telescope')

    return telescope
  }

  async function rightAscension(telescope: ConfiguredDevice, signal?: AbortSignal) {
    const hours = bounded(await client.readNumber(telescope, 'rightascension', signal), 0, 24, 'right ascension')

    if (hours === 24) invalid('Hours must be less than 24', 'rightascension')

    return hours * 15
  }

  async function frameColor(
    camera: ConfiguredDevice,
    monochromeOnly: boolean,
    signal?: AbortSignal,
  ): Promise<AlpacaFrameColor> {
    const sensorType = await client.readNumber(camera, 'sensortype', signal)

    if (!Number.isInteger(sensorType) || sensorType < 0 || sensorType > 5)
      invalid('Invalid camera sensor type', 'sensortype')

    if (sensorType === 0) return { kind: 'mono' }

    if (monochromeOnly) throw new Error('This acquisition requires a monochrome camera')

    if (sensorType !== 2) throw new Error('Only monochrome and RGGB Bayer camera sensors are supported')
    const binX = await client.readNumber(camera, 'binx', signal)
    const binY = await client.readNumber(camera, 'biny', signal)

    if (!Number.isInteger(binX) || !Number.isInteger(binY) || binX < 1 || binY < 1)
      invalid('Invalid camera binning', 'binx/biny')

    if (binX !== 1 || binY !== 1) throw new Error('Bayer color capture requires 1 × 1 binning')
    const offsetX = await client.readNumber(camera, 'bayeroffsetx', signal)
    const offsetY = await client.readNumber(camera, 'bayeroffsety', signal)

    if (![offsetX, offsetY].every(value => value === 0 || value === 1))
      invalid('Invalid RGGB Bayer offset', 'bayeroffsetx/bayeroffsety')
    const startX = await client.readNumber(camera, 'startx', signal)
    const startY = await client.readNumber(camera, 'starty', signal)

    if (![startX, startY].every(value => Number.isInteger(value) && value >= 0 && value <= 2147483647))
      invalid('Invalid camera subframe origin', 'startx/starty')
    // ASCOM offsets refer to the full sensor and do not include StartX/StartY.
    // A 2×2 matrix repeats, so subtracting and adding its offset have equal parity.
    const patterns = ['rggb', 'grbg', 'gbrg', 'bggr'] as const
    const pattern = patterns[((startY + offsetY) % 2) * 2 + (startX + offsetX) % 2]!

    return { kind: 'bayer', pattern }
  }

  async function exposureStart(camera: ConfiguredDevice, signal?: AbortSignal): Promise<string | undefined> {
    try {
      const stamp = await client.readString(camera, 'lastexposurestarttime', signal)

      // ASI drivers can return blank success for this optional property.
      return stamp.trim() === '' ? undefined : stamp
    } catch (error) {
      if (error instanceof AlpacaProviderError && error.reason === 'protocol-error' && error.errorNumber === 1024)
        return undefined
      throw error
    }
  }

  return {
    async capture({
      cameraId,
      expectedCameraName,
      exposureSeconds,
      monochromeOnly = false,
      signal,
      onProgress,
      onReadout,
      onReadState,
    }) {
      bounded(exposureSeconds, 0.001, 3600, 'exposure duration')

      if (expectedCameraName !== undefined && expectedCameraName.trim() === '')
        throw new RangeError('Expected camera name must not be blank')
      let camera: ConfiguredDevice | undefined
      let attempted = false
      let acknowledged = false

      try {
        camera = await device(cameraId, 'camera', signal)

        if (!(await client.connected(camera, signal))) throw new Error('Camera is disconnected')
        const color = await frameColor(camera, monochromeOnly, signal)

        if (await client.readNumber(camera, 'camerastate', signal) !== 0) throw new Error('Camera is already active')

        if (!(await client.readBoolean(camera, 'canabortexposure', signal)))
          throw new Error('Camera cannot abort an exposure')
        const width = await client.readNumber(camera, 'numx', signal)
        const height = await client.readNumber(camera, 'numy', signal)

        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 40_000_000)
          invalid('Invalid camera image dimensions', 'numx/numy')

        const previousStart = await client.readBoolean(camera, 'imageready', signal)
          ? await exposureStart(camera, signal)
          : undefined

        const currentName = (await client.readString(camera, 'name', signal)).trim()

        if (!currentName) invalid('Camera returned a blank operational name', 'name')

        if (expectedCameraName !== undefined && currentName !== expectedCameraName.trim())
          throw new Error('The camera in this driver slot has changed; select the imaging camera again')

        signal?.throwIfAborted()
        const startedAt = performance.now()
        const requestedAt = new Date().toISOString()
        attempted = true
        // A lost response can still mean the exposure started. Never replay it.
        await client.command(camera, 'startexposure', { Duration: String(exposureSeconds), Light: 'true' }, signal)
        acknowledged = true
        const exposedCamera = camera
        let interrupted = false
        let observedNotReady = false

        async function revalidateCamera() {
          const devices = await client.configuredDevices(signal)
          rejectDuplicateDeviceIds(devices)

          const sameSlot = devices.find(candidate => candidate.DeviceType.toLowerCase() === 'camera'
            && candidate.DeviceNumber === exposedCamera.DeviceNumber)

          if (!sameSlot || stableDeviceId(sameSlot) !== cameraId) {
            camera = undefined
            throw new Error('Camera identity changed during the interruption; original exposure outcome is unconfirmed')
          }

          if ((await client.readString(exposedCamera, 'name', signal)).trim() !== currentName) {
            camera = undefined
            throw new Error('Camera in this driver slot changed during the interruption; original exposure outcome is unconfirmed')
          }

          if (!(await client.connected(exposedCamera, signal))) throw new Error('Camera disconnected during the exposure')
          const currentColor = await frameColor(exposedCamera, monochromeOnly, signal)

          if (await client.readNumber(exposedCamera, 'numx', signal) !== width
            || await client.readNumber(exposedCamera, 'numy', signal) !== height
            || JSON.stringify(currentColor) !== JSON.stringify(color))
            throw new Error('Camera image configuration changed during the exposure')
        }

        // Only reads of this acknowledged exposure belong here. Start and cleanup
        // remain single commands; unresponsive reads do not discard an exposure.
        async function observe<T>(read: () => Promise<T>): Promise<T> {
          while (true) {
            signal?.throwIfAborted()

            try {
              if (interrupted) await revalidateCamera()
              const result = await read()
              signal?.throwIfAborted()

              if (interrupted) {
                interrupted = false
                onReadState?.('current')
                trace.getTracer('@vela/alpaca').startSpan('alpaca.capture.read-recovered', {
                  attributes: { 'alpaca.device.id': cameraId },
                }).end()
              }

              return result
            } catch (error) {
              if (signal?.aborted || !(error instanceof AlpacaProviderError) || error.reason !== 'transport')
                throw error

              if (!interrupted) {
                interrupted = true
                onReadState?.('retrying')
                trace.getTracer('@vela/alpaca').startSpan('alpaca.capture.read-interrupted', {
                  attributes: {
                    'alpaca.device.id': cameraId,
                    'alpaca.read.endpoint': error.endpoint ?? '',
                  },
                }).end()
              }

              await delay(readRetryIntervalMs, undefined, signal === undefined ? {} : { signal })
            }
          }
        }

        async function ready() {
          const imageReady = await client.readBoolean(exposedCamera, 'imageready', signal)

          if (imageReady) return true
          observedNotReady = true
          const elapsed = (performance.now() - startedAt) / 1000
          const cameraState = await client.readNumber(exposedCamera, 'camerastate', signal)

          if (!Number.isInteger(cameraState) || cameraState < 0 || cameraState > 5)
            invalid('Invalid camera activity state', 'camerastate')

          if (cameraState === 5) throw new Error('Camera reported an exposure error')

          if (elapsed > exposureSeconds + 60) throw new Error('Camera exposure did not complete in time')

          return false
        }

        while (!(await observe(ready))) {
          const elapsed = (performance.now() - startedAt) / 1000
          onProgress?.(Math.min(elapsed, exposureSeconds))
          await delay(200, undefined, signal === undefined ? {} : { signal })
        }

        const stamp = await observe(() => exposureStart(exposedCamera, signal))

        if (stamp === undefined && !observedNotReady)
          invalid('Camera exposure freshness is unconfirmed without a timestamp or image-ready transition', 'imageready')

        if (stamp !== undefined && stamp === previousStart)
          invalid('Camera returned the previous exposure; freshness is unconfirmed', 'lastexposurestarttime')

        const capturedAt = stamp === undefined
          ? requestedAt
          : stamp.endsWith('Z') ? stamp : `${stamp}Z`

        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(capturedAt) || !Number.isFinite(Date.parse(capturedAt)))
          invalid('Invalid exposure UTC timestamp', 'lastexposurestarttime')
        onReadout?.()

        const frame = await observe(async () => {
          if (!(await client.readBoolean(exposedCamera, 'imageready', signal)))
            throw new Error('The completed exposure is no longer available')

          if (await exposureStart(exposedCamera, signal) !== stamp)
            throw new Error('Exposure changed before image transfer; freshness is unconfirmed')
          const image = await client.image(exposedCamera, signal)

          if (!(await client.readBoolean(exposedCamera, 'imageready', signal))
            || await exposureStart(exposedCamera, signal) !== stamp)
            throw new Error('Exposure changed during image transfer; freshness is unconfirmed')

          return decodeFrame(image, width, height, capturedAt, color)
        })

        return stamp === undefined ? { ...frame, capturedAtSource: 'server-estimate' } : frame
      } catch (error) {
        // Cleanup failure must win over cancellation: an aborted request alone
        // cannot establish that the physical exposure stopped.
        if (attempted && camera) await stopCamera(camera)

        if (signal?.aborted && (error === signal.reason || error instanceof Error && error.name === 'AbortError')) {
          throw new AlpacaCaptureStoppedError()
        }

        if (!signal?.aborted && (!attempted || acknowledged) && error instanceof AlpacaProviderError && error.reason === 'transport') {
          throw new AlpacaCaptureRetryableError(error)
        }

        throw error
      }
    },

    async pointing(telescopeId, signal) {
      const telescope = await device(telescopeId, 'telescope', signal)
      const ra = bounded(await client.readNumber(telescope, 'rightascension', signal), 0, 24, 'right ascension')
      const dec = bounded(await client.readNumber(telescope, 'declination', signal), -90, 90, 'declination')
      const sidereal = bounded(await client.readNumber(telescope, 'siderealtime', signal), 0, 24, 'sidereal time')

      if (ra === 24 || sidereal === 24) invalid('Hours must be less than 24', 'rightascension/siderealtime')
      const latitude = bounded(await client.readNumber(telescope, 'sitelatitude', signal), -90, 90, 'latitude')
      const tracking = await client.readBoolean(telescope, 'tracking', signal)
      const system = await client.readNumber(telescope, 'equatorialsystem', signal)
      const coordinateSystem = coordinateSystems[system]

      if (coordinateSystem === undefined) invalid('Invalid equatorial coordinate system', 'equatorialsystem')

      return {
        rightAscensionDegrees: ra * 15,
        declinationDegrees: dec,
        siderealTimeDegrees: sidereal * 15,
        latitudeDegrees: latitude,
        tracking,
        coordinateSystem,
      }
    },

    async move(telescopeId, rateDegreesPerSecond, durationSeconds, signal) {
      bounded(durationSeconds, 0, 120, 'movement duration')
      const telescope = await primaryAxis(telescopeId, rateDegreesPerSecond, signal)
      signal?.throwIfAborted()

      try {
        await client.command(telescope, 'moveaxis', { Axis: '0', Rate: String(rateDegreesPerSecond) }, signal)
        await delay(durationSeconds * 1000, undefined, signal === undefined ? {} : { signal })
      } finally {
        // The user's cancellation must not cancel the stop command.
        await stopTelescope(telescope)
      }
    },

    async rotateRightAscension(telescopeId, rateDegreesPerSecond, distanceDegrees, signal) {
      return trace.getTracer('@vela/alpaca').startActiveSpan('alpaca.rotate_right_ascension', { attributes: {
        'alpaca.device.id': telescopeId,
        'alpaca.motion.rate_degrees_per_second': rateDegreesPerSecond,
        'alpaca.motion.distance_degrees': distanceDegrees,
      } }, async span => {
        try {
          bounded(distanceDegrees, -120, 120, 'RA travel')

          if (distanceDegrees === 0 || rateDegreesPerSecond === 0) throw new RangeError('RA travel and rate must be nonzero')
          const telescope = await primaryAxis(telescopeId, rateDegreesPerSecond, signal)
          const start = await rightAscension(telescope, signal)
          const duration = Math.min(120_000, Math.abs(distanceDegrees / rateDegreesPerSecond) * 2000 + 2000)
          signal?.throwIfAborted()
          span.setAttributes({ 'alpaca.ra.start_degrees': start, 'alpaca.motion.timeout_ms': duration })
          const deadline = performance.now() + duration
          const timeoutError = new Error('Telescope did not reach the requested RA travel before timeout')
          const timeout = new AbortController()
          const motionSignal = signal === undefined ? timeout.signal : AbortSignal.any([signal, timeout.signal])
          const timer = setTimeout(() => timeout.abort(timeoutError), Math.ceil(duration))

          function requireActiveMotion() {
            // Also check elapsed time after a response: a delayed event loop may
            // deliver the response before the expired timer callback runs.
            if (performance.now() >= deadline) timeout.abort(timeoutError)
            motionSignal.throwIfAborted()
          }

          try {
            requireActiveMotion()
            await client.command(telescope, 'moveaxis', { Axis: '0', Rate: String(rateDegreesPerSecond) }, motionSignal)
            requireActiveMotion()

            while (true) {
              await delay(100, undefined, { signal: motionSignal })
              requireActiveMotion()
              const current = await rightAscension(telescope, motionSignal)
              requireActiveMotion()
              const travelled = (((current - start + 540) % 360) - 180) * Math.sign(distanceDegrees)

              if (travelled < -1) throw new Error('Telescope RA moved in the opposite direction')

              if (travelled >= Math.abs(distanceDegrees)) {
                span.addEvent('alpaca.rotation.threshold', {
                  'alpaca.ra.degrees': current,
                  'alpaca.ra.travelled_degrees': travelled,
                })
                break
              }
            }
          } catch (error) {
            if (motionSignal.aborted) throw motionSignal.reason
            throw error
          } finally {
            clearTimeout(timer)
            await stopTelescope(telescope)
          }

          span.setStatus({ code: SpanStatusCode.OK })
        } catch (error) {
          span.recordException(error instanceof Error ? error : String(error))
          span.setStatus({ code: SpanStatusCode.ERROR })
          throw error
        } finally {
          span.end()
        }
      })
    },

    async abort(cameraId, telescopeId) {
      const results = await Promise.allSettled([
        device(cameraId, 'camera').then(stopCamera),
        device(telescopeId, 'telescope').then(stopTelescope),
      ])

      const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : [])

      if (errors.length > 0) throw new AggregateError(errors, 'Could not confirm acquisition stopped')
    },
  }
}
