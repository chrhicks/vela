import type { Star, StarSource } from './catalog.js'
import { cameraGeometry, fieldHeightDegrees } from './optics.js'

export { imageWidth, imageHeight } from './optics.js'

import { cameraPose, siderealRadiansPerSecond } from './mount.js'
import type { CameraPose } from './mount.js'
import { renderSkyAsync } from './sky.js'

function isFixedCatalog(stars: readonly Star[] | StarSource): stars is readonly Star[] {
  return Array.isArray(stars)
}

const normalizeDegrees = (value: number) => ((value % 360) + 360) % 360

const slewDegreesPerSecond = 30

const siderealDegreesPerSecond = siderealRadiansPerSecond * 180 / Math.PI

export type Preset = 'large-error' | 'near-aligned' | 'aligned'

export interface CameraState {
  number: number
  connected: boolean
  activity: 'idle' | 'exposing'
  imageReady: boolean
  width: number
  height: number
  sensor: 'mono' | 'rggb'
  resolution: 'fast' | 'full'
}

interface Camera {
  connected: boolean
  resolution: 'fast' | 'full'
  exposure: Exposure | undefined
  completed: Exposure | undefined
  rendering: Promise<Uint16Array> | undefined
  cancellation: AbortController | undefined
  seed: number
}

export interface SimulatorState {
  cameras: CameraState[]
  altitudeArcsec: number
  azimuthArcsec: number
  obscured: boolean
  cameraConnected: boolean
  telescopeConnected: boolean
  cameraActivity: 'idle' | 'exposing'
  imageReady: boolean
  tracking: boolean
  slewing: boolean
  raAxisDegrees: number
  raRateDegreesPerSecond: number
  rightAscensionHours: number
  declinationDegrees: number
}

export class SimulatorError extends Error {
  constructor(readonly number: number, message: string) {
    super(message)
  }
}

interface Exposure {
  start: number
  duration: number
  timestamp: string
  pose: CameraPose
  obscured: boolean
  seed: number
  width: number
  height: number
}

export class SimulatorRuntime {
  private epoch: number
  private updated: number
  private joint = 30
  private declination = 60
  private slew: { start: number; duration: number; ra: number; dec: number; deltaRa: number; deltaDec: number } | undefined
  private rate = 0
  private tracking = true
  private altitude = 480
  private azimuth = -360
  private obscured = false
  private telescopeConnected = false
  private cameras: Camera[] = [0, 1].map(() => ({ connected: false, resolution: 'full', seed: 0, exposure: undefined, completed: undefined, rendering: undefined, cancellation: undefined }))
  private camera(number = 0) {
    const camera = this.cameras[number]

    if (!camera) throw new SimulatorError(0x401, 'Unknown camera')

    return camera
  }
  cameraState(number = 0): CameraState {
    this.advance()
    const camera = this.camera(number)

    return { number, connected: camera.connected, activity: camera.exposure ? 'exposing' : 'idle',
      imageReady: !!camera.completed, sensor: number === 0 ? 'mono' : 'rggb', resolution: camera.resolution,
      width: cameraGeometry(camera.resolution).width,
      height: cameraGeometry(camera.resolution).height }
  }
  configureCamera(number: number, resolution: 'fast' | 'full') {
    this.advance()
    const camera = this.camera(number)

    if (camera.exposure) throw new SimulatorError(0x40b, 'An exposure is in progress')

    if (resolution !== 'fast' && resolution !== 'full') throw new SimulatorError(0x401, 'Unknown resolution')

    if (camera.resolution === resolution) return
    this.abortExposure(number)
    camera.resolution = resolution
  }
  constructor(private readonly stars: readonly Star[] | StarSource, private readonly now: () => number = () => performance.now()) {
    this.epoch = this.updated = now()
  }
  private advance() {
    const time = Math.max(this.updated, this.now())
    const seconds = (time - this.updated) / 1000

    if (this.slew) {
      const slew = this.slew
      const fraction = Math.min(1, (time - slew.start) / slew.duration)
      const ra = slew.ra + slew.deltaRa * fraction
      this.declination = slew.dec + slew.deltaDec * fraction
      this.joint = ra - (time - this.epoch) / 1000 * siderealDegreesPerSecond

      if (fraction === 1) {
        this.slew = undefined
      }
    } else {
      this.joint += seconds * (this.rate !== 0 ? this.rate : this.tracking ? -siderealDegreesPerSecond : 0)
    }

    this.updated = time

    for (const camera of this.cameras) {
      if (camera.exposure && time >= camera.exposure.start + camera.exposure.duration * 1000) {
        camera.completed = camera.exposure
        camera.exposure = undefined
      }
    }
  }
  private elapsed() {
    return (this.updated - this.epoch) / 1000
  }
  siderealTimeHours() {
    this.advance()

    return (this.elapsed() * siderealDegreesPerSecond / 15) % 24
  }
  private pose() {
    return cameraPose({ latitudeDegrees: 40, altitudeErrorDegrees: this.altitude / 3600,
      azimuthErrorDegrees: this.azimuth / 3600, raAxisDegrees: this.joint,
      declinationDegrees: this.declination, elapsedSeconds: this.elapsed(), tracking: false })
  }
  state(): SimulatorState {
    this.advance()
    const cameras = this.cameras.map((_, number) => this.cameraState(number))
    const mono = cameras[0]!

    return { altitudeArcsec: this.altitude, azimuthArcsec: this.azimuth, obscured: this.obscured,
      cameras, cameraConnected: mono.connected, telescopeConnected: this.telescopeConnected,
      cameraActivity: mono.activity, imageReady: mono.imageReady,
      tracking: this.rate === 0 && this.tracking,
      slewing: !!this.slew || this.rate !== 0,
      raAxisDegrees: this.joint + this.elapsed() * siderealDegreesPerSecond,
      raRateDegreesPerSecond: this.rate,
      rightAscensionHours: normalizeDegrees(this.joint + this.elapsed() * siderealDegreesPerSecond) / 15,
      declinationDegrees: this.declination }
  }
  connect(device: 'camera' | 'telescope', connected: boolean, number = 0) {
    this.advance()

    if (device === 'camera') {
      this.camera(number).connected = connected

      if (!connected) this.abortExposure(number)
    } else {
      this.telescopeConnected = connected

      if (!connected) this.stop()
    }
  }
  requireConnected(device: 'camera' | 'telescope', number = 0) {
    if (!(device === 'camera' ? this.camera(number).connected : this.telescopeConnected)) throw new SimulatorError(0x407, `${device} is disconnected`)
  }
  private requireIdle() {
    this.advance()

    if (this.cameras.some(camera => camera.exposure)) throw new SimulatorError(0x40b, 'An exposure is in progress')
  }
  adjust(altitude: number, azimuth: number) {
    this.requireIdle()

    if (this.slew || this.rate !== 0) throw new SimulatorError(0x40b, 'Stop mount movement before adjusting the mount')

    if (![altitude, azimuth].every(value => Number.isFinite(value) && Math.abs(value) <= 18000)) throw new SimulatorError(0x401, 'Offsets must be within ±18000 arcseconds')
    this.altitude = altitude
    this.azimuth = azimuth
  }
  setObscured(obscured: boolean) {
    this.obscured = obscured
  }
  reset(preset: Preset) {
    this.advance()
    this.cameras.forEach((camera, number) => {
      this.abortExposure(number)
      camera.seed = 0
    })
    this.epoch = this.updated
    this.joint = 30
    this.declination = 60
    this.slew = undefined
    this.rate = 0
    this.tracking = true
    this.obscured = false

    const offsets = {
      'large-error': { altitude: 480, azimuth: -360 },
      'near-aligned': { altitude: 12, azimuth: -9 },
      aligned: { altitude: 0, azimuth: 0 },
    }[preset]

    this.altitude = offsets.altitude
    this.azimuth = offsets.azimuth
  }
  setTracking(tracking: boolean) {
    this.requireIdle()

    if (this.rate !== 0 || this.slew) throw new SimulatorError(0x40b, 'Stop mount movement before changing tracking')
    this.tracking = tracking
  }
  move(rate: number) {
    this.advance()

    if (rate !== 0) this.requireIdle()

    if (!Number.isFinite(rate) || Math.abs(rate) > 1.5) throw new SimulatorError(0x401, 'RA rate must be within ±1.5 degrees per second')

    if (this.slew) throw new SimulatorError(0x40b, 'Stop coordinate slew before moving an axis')
    this.rate = rate
  }
  slewTo(rightAscensionHours: number, declinationDegrees: number) {
    this.requireIdle()

    if (!Number.isFinite(rightAscensionHours) || rightAscensionHours < 0 || rightAscensionHours >= 24
      || !Number.isFinite(declinationDegrees) || Math.abs(declinationDegrees) > 90) {
      throw new SimulatorError(0x401, 'Slew coordinates must be RA [0, 24) hours and Dec [-90, 90] degrees')
    }

    if (this.slew || this.rate !== 0) throw new SimulatorError(0x40b, 'Stop mount movement before starting a slew')

    if (!this.tracking) throw new SimulatorError(0x40b, 'Equatorial slew requires tracking')
    const ra = normalizeDegrees(this.joint + this.elapsed() * siderealDegreesPerSecond)
    const deltaRa = normalizeDegrees(rightAscensionHours * 15 - ra + 180) - 180
    const deltaDec = declinationDegrees - this.declination
    const duration = Math.max(Math.abs(deltaRa), Math.abs(deltaDec)) / slewDegreesPerSecond * 1000

    if (duration === 0) return
    this.slew = { start: this.updated, duration, ra, dec: this.declination, deltaRa, deltaDec }
  }
  stop() {
    this.advance()
    this.slew = undefined
    this.rate = 0
  }
  startExposure(duration: number, light: boolean, number = 0) {
    this.advance()
    const camera = this.camera(number)

    if (camera.exposure) throw new SimulatorError(0x40b, 'An exposure is in progress')

    if (!Number.isFinite(duration) || duration < 0 || duration > 3600) throw new SimulatorError(0x401, 'Exposure duration must be between 0 and 3600 seconds')

    if (this.rate !== 0 || this.slew) throw new SimulatorError(0x40b, 'Stop mount movement before exposing')
    // The rendered field must fit wholly inside the provisioned catalog patch.
    // A circumscribed spherical field also covers image corners and camera roll.
    const pose = this.pose()
    const ra = normalizeDegrees(Math.atan2(pose.direction[1], pose.direction[0]) * 180 / Math.PI)
    const dec = Math.asin(pose.direction[2]) * 180 / Math.PI
    const { width, height } = this.cameraState(number)
    const fieldRadius = Math.atan(Math.tan(fieldHeightDegrees / 2 * Math.PI / 180) * Math.hypot(width / height, 1))
    const declinationMargin = fieldRadius * 180 / Math.PI
    const raMargin = Math.asin(Math.sin(fieldRadius) / Math.cos(dec * Math.PI / 180)) * 180 / Math.PI

    if (isFixedCatalog(this.stars) && (ra - raMargin < 0 || ra + raMargin > 70 || dec - declinationMargin < 50
      || dec + declinationMargin > 70)) {
      throw new SimulatorError(0x40b, 'Camera field is outside the supported catalog patch (RA 0–70°, Dec 50–70°); move back or reset the simulator')
    }

    this.abortExposure(number)
    camera.exposure = { start: this.updated, duration, timestamp: new Date().toISOString().replace(/Z$/, ''),
      pose, obscured: this.obscured || !light, seed: ++camera.seed, width, height }
  }
  abortExposure(number = 0) {
    const camera = this.camera(number)
    camera.cancellation?.abort()
    camera.cancellation = undefined
    camera.exposure = undefined
    camera.completed = undefined
    camera.rendering = undefined
  }
  lastExposure(number = 0) {
    this.advance()
    const exposure = this.camera(number).completed

    if (!exposure) throw new SimulatorError(0x40b, 'No completed exposure is available')

    return exposure
  }
  async frame(number = 0) {
    const exposure = this.lastExposure(number)
    const camera = this.camera(number)

    const assertCurrent = () => {
      if (camera.completed !== exposure) throw new SimulatorError(0x40b, 'The exposure was discarded')
    }

    if (!camera.rendering) {
      camera.cancellation = new AbortController()
      const signal = camera.cancellation.signal
      camera.rendering = (async () => {
        const direction = exposure.pose.direction

        const radiusDegrees = Math.atan(Math.tan(fieldHeightDegrees / 2 * Math.PI / 180)
          * Math.hypot(exposure.width / exposure.height, 1)) * 180 / Math.PI
          + fieldHeightDegrees / exposure.height * 12

        const stars = !isFixedCatalog(this.stars) ? await this.stars({
          raDegrees: normalizeDegrees(Math.atan2(direction[1], direction[0]) * 180 / Math.PI),
          decDegrees: Math.asin(direction[2]) * 180 / Math.PI,
          radiusDegrees,
        }, signal) : this.stars

        assertCurrent()
        signal.throwIfAborted()

        return renderSkyAsync(stars, exposure.pose, {
          width: exposure.width, height: exposure.height, fieldHeightDegrees,
          seed: exposure.seed, obscured: exposure.obscured,
          sensor: number === 0 ? 'monochrome' : 'rggb', exposureSeconds: exposure.duration,
        }, signal)
      })()
    }

    try {
      const pixels = await camera.rendering
      assertCurrent()

      return { pixels, width: exposure.width, height: exposure.height, assertCurrent }
    } catch (error) {
      assertCurrent()
      camera.rendering = undefined
      throw error
    }
  }
}
