import type { Star } from './catalog.js'
import { cameraPose, siderealRadiansPerSecond } from './mount.js'
import type { CameraPose } from './mount.js'
import { renderSkyAsync } from './sky.js'

export const imageWidth = 1600
export const imageHeight = 1200
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
  private rate = 0
  private tracking = true
  private altitude = 480
  private azimuth = -360
  private obscured = false
  private telescopeConnected = false
  private cameras: Camera[] = [0, 1].map(() => ({ connected: false, resolution: 'fast', seed: 0, exposure: undefined, completed: undefined, rendering: undefined, cancellation: undefined }))
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
      width: camera.resolution === 'full' ? 6248 : imageWidth,
      height: camera.resolution === 'full' ? 4176 : imageHeight }
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
  constructor(private readonly stars: readonly Star[], private readonly now: () => number = () => performance.now()) {
    this.epoch = this.updated = now()
  }
  private advance() {
    const time = Math.max(this.updated, this.now())
    const seconds = (time - this.updated) / 1000
    const previousRa = this.joint + this.elapsed() * siderealDegreesPerSecond
    this.joint += seconds * (this.rate !== 0 ? this.rate : this.tracking ? -siderealDegreesPerSecond : 0)
    this.updated = time
    const ra = this.joint + this.elapsed() * siderealDegreesPerSecond
    const netRaRate = this.rate + siderealDegreesPerSecond
    if (this.rate !== 0 && ((netRaRate < 0 && ra < 10) || (netRaRate > 0 && ra > 50))) {
      const boundary = ra < 10 ? 10 : 50
      const secondsToBoundary = (boundary - previousRa) / netRaRate
      const remainingSeconds = Math.max(0, seconds - secondsToBoundary)
      const drift = this.tracking ? 0 : remainingSeconds * siderealDegreesPerSecond
      this.joint = boundary + drift - this.elapsed() * siderealDegreesPerSecond
      this.rate = 0
    }
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
      declinationDegrees: 60, elapsedSeconds: this.elapsed(), tracking: false })
  }
  state(): SimulatorState {
    this.advance()
    const direction = this.pose().direction
    const cameras = this.cameras.map((_, number) => this.cameraState(number))
    const mono = cameras[0]!
    return { altitudeArcsec: this.altitude, azimuthArcsec: this.azimuth, obscured: this.obscured,
      cameras, cameraConnected: mono.connected, telescopeConnected: this.telescopeConnected,
      cameraActivity: mono.activity, imageReady: mono.imageReady,
      tracking: this.rate === 0 && this.tracking,
      raAxisDegrees: this.joint + this.elapsed() * siderealDegreesPerSecond,
      raRateDegreesPerSecond: this.rate,
      rightAscensionHours: ((Math.atan2(direction[1], direction[0]) * 180 / Math.PI + 360) % 360) / 15,
      declinationDegrees: Math.asin(direction[2]) * 180 / Math.PI }
  }
  connect(device: 'camera' | 'telescope', connected: boolean, number = 0) {
    this.advance()
    if (device === 'camera') {
      this.camera(number).connected = connected
      if (!connected) this.abortExposure(number)
    } else {
      this.telescopeConnected = connected
      if (!connected) this.rate = 0
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
    this.rate = 0
    this.tracking = true
    this.obscured = false
    this.altitude = preset === 'large-error' ? 480 : preset === 'near-aligned' ? 12 : 0
    this.azimuth = preset === 'large-error' ? -360 : preset === 'near-aligned' ? -9 : 0
  }
  setTracking(tracking: boolean) {
    this.requireIdle()
    if (this.rate !== 0) throw new SimulatorError(0x40b, 'Stop axis movement before changing tracking')
    this.tracking = tracking
  }
  move(rate: number) {
    this.advance()
    if (rate !== 0) this.requireIdle()
    if (!Number.isFinite(rate) || Math.abs(rate) > 1.5) throw new SimulatorError(0x401, 'RA rate must be within ±1.5 degrees per second')
    const ra = this.state().raAxisDegrees
    const netRaRate = rate + siderealDegreesPerSecond
    if (rate !== 0 && ((ra <= 10 && netRaRate < 0) || (ra >= 50 && netRaRate > 0))) throw new SimulatorError(0x40b, 'Movement would leave the catalog sky patch')
    this.rate = rate
  }
  startExposure(duration: number, light: boolean, number = 0) {
    this.advance()
    const camera = this.camera(number)
    if (camera.exposure) throw new SimulatorError(0x40b, 'An exposure is in progress')
    if (!Number.isFinite(duration) || duration < 0 || duration > 3600) throw new SimulatorError(0x401, 'Exposure duration must be between 0 and 3600 seconds')
    if (this.rate !== 0) throw new SimulatorError(0x40b, 'Stop axis movement before exposing')
    // The rendered field must fit wholly inside the provisioned catalog patch.
    // A circumscribed spherical field also covers image corners and camera roll.
    const state = this.state()
    const { width, height } = this.cameraState(number)
    const fieldRadius = Math.atan(Math.tan(1.5 * Math.PI / 180) * Math.hypot(width / height, 1))
    const declinationMargin = fieldRadius * 180 / Math.PI
    const raMargin = Math.asin(Math.sin(fieldRadius) / Math.cos(state.declinationDegrees * Math.PI / 180)) * 180 / Math.PI
    const ra = state.rightAscensionHours * 15
    if (ra - raMargin < 0 || ra + raMargin > 70 || state.declinationDegrees - declinationMargin < 50
      || state.declinationDegrees + declinationMargin > 70) {
      throw new SimulatorError(0x40b, 'Camera field is outside the supported catalog patch (RA 0–70°, Dec 50–70°); move back or reset the simulator')
    }
    this.abortExposure(number)
    camera.exposure = { start: this.updated, duration, timestamp: new Date().toISOString().replace(/Z$/, ''),
      pose: this.pose(), obscured: this.obscured || !light, seed: ++camera.seed, width, height }
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
      camera.rendering = renderSkyAsync(this.stars, exposure.pose, {
        width: exposure.width, height: exposure.height, fieldHeightDegrees: 3,
        seed: exposure.seed, obscured: exposure.obscured,
        sensor: number === 0 ? 'monochrome' : 'rggb', exposureSeconds: exposure.duration,
      }, camera.cancellation.signal)
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
