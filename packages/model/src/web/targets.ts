/** Catalog and framing positions are fixed J2000 equatorial degrees. */
export interface TargetPosition { raDegrees: number, decDegrees: number }

export interface TargetView extends TargetPosition {
  id: string
  name: string
  catalog: string
  kind: string
  sizeArcminutes: number | null
  thumbnailUrl: string
  sky: TargetSkyPath | null
}

export interface TargetSkyPath {
  observedAt: string
  startsAt: string
  endsAt: string
  samples: Array<{ at: string, altitudeDegrees: number, sunAltitudeDegrees: number }>
  currentAltitudeDegrees: number
  highestAltitudeDegrees: number
  aboveHorizonDuringDarkness: Array<{ startsAt: string, endsAt: string }>
}

export interface TargetsView {
  rigId: string
  rigName: string
  targets: TargetView[]
  total: number
  site: { latitudeDegrees: number, longitudeDegrees: number } | null
  siteUnavailableReason: string | null
}

export interface FramingView {
  rigId: string
  rigName: string
  enabled: boolean
  unavailableReason: string | null
  observedAt: string
  focalLengthMm: number | null
  camera: { name: string, width: number, height: number, fieldWidthDegrees: number, fieldHeightDegrees: number } | null
  phase: 'idle' | 'slewing' | 'exposing' | 'solving' | 'checked' | 'stopping' | 'stopped' | 'failed'
  active: boolean
  desired: TargetPosition | null
  targetId: string | null
  actual: (TargetPosition & { capturedAt: string, corners: TargetPosition[], rotationDegrees: number, offsetArcminutes: number }) | null
  error: string | null
  exposureSeconds: number
  canCenter: boolean
  /** The last solved exposure still matches the observed rig/configuration. */
  checkCurrent: boolean
}
