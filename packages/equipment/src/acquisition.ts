import type { CoordinateSystem } from './framing.js'

export type FrameColor =
  | { kind: 'mono' }
  | { kind: 'bayer'; pattern: 'rggb' | 'grbg' | 'gbrg' | 'bggr' }

export interface Frame {
  width: number
  height: number
  /** Row-major, pixels[y * width + x]. */
  pixels: Float64Array
  capturedAt: string
  /** Missing means a camera-supplied timestamp (including older callers). */
  capturedAtSource?: 'camera' | 'server-estimate'
  /** Color layout at the returned image origin, after accounting for subframe position. */
  color: FrameColor
}

export interface CaptureOptions {
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

export interface Pointing {
  rightAscensionDegrees: number
  declinationDegrees: number
  siderealTimeDegrees: number
  latitudeDegrees: number
  tracking: boolean
  coordinateSystem: Exclude<CoordinateSystem, 'unknown'>
}

export interface Acquisition {
  capture(options: CaptureOptions): Promise<Frame>
  pointing(telescopeId: string, signal?: AbortSignal): Promise<Pointing>
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
