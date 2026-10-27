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

/**
 * Which request, operation and image an adapter says one exposure came from. An adapter whose
 * protocol hands out no such ids reports nothing. An id is null until the adapter learns it, and
 * stays null when the exposure ends before it exists.
 */
export interface CaptureProvenance {
  requestId: string
  operationId: string | null
  imageId: string | null
}

/** What an exposure is for. An adapter that cannot tell its camera ignores it. */
export type CaptureFrameType = 'light' | 'dark' | 'flat' | 'dark-flat' | 'bias'

export interface CaptureOptions {
  cameraId: string
  /** Confirm the operational camera name when a driver slot can host different hardware. */
  expectedCameraName?: string
  exposureSeconds: number
  /** Defaults to `light`. */
  frameType?: CaptureFrameType
  /** Reject color before starting when the consumer requires monochrome samples. */
  monochromeOnly?: boolean
  signal?: AbortSignal
  onProgress?: (elapsedSeconds: number) => void
  onReadout?: () => void
  /** Called immediately before the StartExposure command is sent; for latency observation only. */
  onExposureRequested?: () => void
  /** Observation of this acknowledged exposure is interrupted; no new exposure is started. */
  onReadState?: (state: 'retrying' | 'current') => void
  /** Called each time the adapter learns another id of this exposure, including when it then fails. */
  onProvenance?: (provenance: CaptureProvenance) => void
}

export interface Pointing {
  rightAscensionDegrees: number
  declinationDegrees: number
  siderealTimeDegrees: number
  latitudeDegrees: number
  tracking: boolean
  coordinateSystem: Exclude<CoordinateSystem, 'unknown'>
}

/**
 * What the camera and mount were set to for an exposure, as read when asked. A member is present
 * only when its reading was fresh; an unread value is absent, never defaulted.
 */
export interface ExposureSettings {
  gain?: number
  offset?: number
  binX?: number
  binY?: number
  /** Effective pixel size in micrometres, after binning. */
  pixelWidthMicrons?: number
  pixelHeightMicrons?: number
  sensorTemperatureC?: number
  /** The cooler setpoint, when the camera has one. */
  setpointC?: number
  /** Which side of the pier the mount sits on, when it reports one. */
  pierSide?: 'east' | 'west'
}

export interface Acquisition {
  capture(options: CaptureOptions): Promise<Frame>
  /**
   * The exposure the camera takes for a `bias` frame whatever time is requested, read when called.
   * An adapter whose camera is not told the frame type has none and omits this.
   */
  biasExposureSeconds?(cameraId: string, signal?: AbortSignal): Promise<number>
  /**
   * The camera's settings, and the mount's pier side when `telescopeId` is given, read when called.
   * Called right after an exposure, it answers from the latest fresh readings and does not wait
   * for the device to be read again after the exposure.
   * Rejects when the camera cannot be read at all. An adapter that cannot read them omits this.
   */
  exposureSettings?(
    options: { cameraId: string; telescopeId?: string },
    signal?: AbortSignal,
  ): Promise<ExposureSettings>
  pointing(telescopeId: string, signal?: AbortSignal): Promise<Pointing>
  move(
    telescopeId: string,
    rateDegreesPerSecond: number,
    durationSeconds: number,
    signal?: AbortSignal,
  ): Promise<void | { travelledDegrees: number }>
  /** Rotate the primary axis until observed RA reaches the signed angular travel. */
  rotateRightAscension(
    telescopeId: string,
    rateDegreesPerSecond: number,
    distanceDegrees: number,
    signal?: AbortSignal,
  ): Promise<void | { travelledDegrees: number }>
  abort(cameraId: string, telescopeId: string): Promise<void>
}
