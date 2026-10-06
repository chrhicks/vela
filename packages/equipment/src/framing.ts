export type CoordinateSystem = 'other' | 'topocentric' | 'j2000' | 'j2050' | 'b1950' | 'unknown'

export interface CameraGeometry {
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

export interface TelescopeStatus {
  rightAscensionDegrees: number
  declinationDegrees: number
  coordinateSystem: CoordinateSystem
  latitudeDegrees?: number
  /** East-positive longitude. */
  longitudeDegrees?: number
  elevationMeters?: number
  tracking: boolean
  trackingRate?: 'sidereal' | 'lunar' | 'solar' | 'king'
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

export interface SlewOptions {
  telescopeId: string
  rightAscensionDegrees: number
  declinationDegrees: number
  /** Coordinates must already be expressed in the driver's reported frame. */
  coordinateSystem: CoordinateSystem
}

export interface Framing {
  cameraGeometry(
    options: { cameraId: string; expectedCameraName?: string },
    signal?: AbortSignal,
  ): Promise<CameraGeometry>
  telescopeStatus(
    telescopeId: string,
    signal?: AbortSignal,
    options?: { includeAlignmentObservations?: boolean; includePointingSide?: boolean },
  ): Promise<TelescopeStatus>
  setTracking(telescopeId: string, tracking: boolean, signal?: AbortSignal): Promise<void>
  slew(options: SlewOptions, signal?: AbortSignal): Promise<void>
  home(telescopeId: string, signal?: AbortSignal): Promise<void>
  abortTelescope(telescopeId: string): Promise<void>
}
