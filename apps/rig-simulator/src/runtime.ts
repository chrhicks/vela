import type { Star } from './catalog.js'
import { cameraPose, siderealRadiansPerSecond } from './mount.js'
import type { CameraPose } from './mount.js'
import { renderSky } from './sky.js'

export const imageWidth = 1600
export const imageHeight = 1200
const siderealDegreesPerSecond = siderealRadiansPerSecond * 180 / Math.PI
export type Preset = 'large-error' | 'near-aligned' | 'aligned'
export interface SimulatorState {
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
  private cameraConnected = false
  private telescopeConnected = false
  private exposure: Exposure | undefined
  private completed: Exposure | undefined
  private pixels: Uint16Array | undefined
  private seed = 0
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
    if (this.exposure && time >= this.exposure.start + this.exposure.duration * 1000) {
      this.completed = this.exposure
      this.exposure = undefined
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
    return { altitudeArcsec: this.altitude, azimuthArcsec: this.azimuth, obscured: this.obscured,
      cameraConnected: this.cameraConnected, telescopeConnected: this.telescopeConnected,
      cameraActivity: this.exposure ? 'exposing' : 'idle', imageReady: !!this.completed,
      tracking: this.rate === 0 && this.tracking,
      raAxisDegrees: this.joint + this.elapsed() * siderealDegreesPerSecond,
      raRateDegreesPerSecond: this.rate,
      rightAscensionHours: ((Math.atan2(direction[1], direction[0]) * 180 / Math.PI + 360) % 360) / 15,
      declinationDegrees: Math.asin(direction[2]) * 180 / Math.PI }
  }
  connect(device: 'camera' | 'telescope', connected: boolean) {
    this.advance()
    if (device === 'camera') {
      this.cameraConnected = connected
      if (!connected) this.abortExposure()
    } else {
      this.telescopeConnected = connected
      if (!connected) this.rate = 0
    }
  }
  requireConnected(device: 'camera' | 'telescope') {
    if (!(device === 'camera' ? this.cameraConnected : this.telescopeConnected)) throw new SimulatorError(0x407, `${device} is disconnected`)
  }
  private requireIdle() {
    this.advance()
    if (this.exposure) throw new SimulatorError(0x40b, 'An exposure is in progress')
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
    this.abortExposure()
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
  startExposure(duration: number, light: boolean) {
    this.requireIdle()
    if (!Number.isFinite(duration) || duration < 0 || duration > 3600) throw new SimulatorError(0x401, 'Exposure duration must be between 0 and 3600 seconds')
    if (this.rate !== 0) throw new SimulatorError(0x40b, 'Stop axis movement before exposing')
    // The rendered field must fit wholly inside the provisioned catalog patch.
    // A circumscribed spherical field also covers image corners and camera roll.
    const state = this.state()
    const fieldRadius = Math.atan(Math.tan(1.5 * Math.PI / 180) * 5 / 3)
    const declinationMargin = fieldRadius * 180 / Math.PI
    const raMargin = Math.asin(Math.sin(fieldRadius) / Math.cos(state.declinationDegrees * Math.PI / 180)) * 180 / Math.PI
    const ra = state.rightAscensionHours * 15
    if (ra - raMargin < 0 || ra + raMargin > 70 || state.declinationDegrees - declinationMargin < 50
      || state.declinationDegrees + declinationMargin > 70) {
      throw new SimulatorError(0x40b, 'Camera field is outside the supported catalog patch (RA 0–70°, Dec 50–70°); move back or reset the simulator')
    }
    this.completed = undefined
    this.pixels = undefined
    this.exposure = { start: this.updated, duration, timestamp: new Date().toISOString().replace(/Z$/, ''),
      pose: this.pose(), obscured: this.obscured || !light, seed: ++this.seed }
  }
  abortExposure() {
    this.exposure = undefined
    this.completed = undefined
    this.pixels = undefined
  }
  lastExposure() {
    this.advance()
    if (!this.completed) throw new SimulatorError(0x40b, 'No completed exposure is available')
    return this.completed
  }
  image() {
    const exposure = this.lastExposure()
    this.pixels ??= renderSky(this.stars, exposure.pose, { width: imageWidth, height: imageHeight,
      fieldHeightDegrees: 3, seed: exposure.seed, obscured: exposure.obscured })
    const pixels = this.pixels
    return Array.from({ length: imageWidth }, (_, x) => Array.from({ length: imageHeight }, (_, y) => pixels[y * imageWidth + x]!))
  }
}
