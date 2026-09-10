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
  samples: Array<{
    at: string
    /** Geometric horizontal coordinates; azimuth increases eastward from north. */
    azimuthDegrees: number
    altitudeDegrees: number
    sunAltitudeDegrees: number
    moon: {
      azimuthDegrees: number
      altitudeDegrees: number
      /** Illuminated fraction as seen from Earth's center, from 0 to 1. */
      illuminationFraction: number
      waxing: boolean
    }
  }>
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

export type TargetCategory = 'emission' | 'reflection-dark' | 'galaxy' | 'cluster' | 'planetary' | 'other'

export type TargetFilterChoice = 'dual-band' | 'broadband' | 'uncertain'

export interface TargetOpportunity {
  /** Approximate remaining astronomical-darkness window above 30 degrees. */
  startsAt: string
  endsAt: string
  usefulMinutes: number
  bestAt: string
  bestAltitudeDegrees: number
  currentAltitudeDegrees: number
}

export interface TargetDiscoveryItem extends TargetView {
  category: TargetCategory
  filterChoice: TargetFilterChoice
  filterReason: string
  opportunity: TargetOpportunity | null
}

/** A frozen calculation shared by every page and filter until explicit refresh. */
export interface TargetDiscoveryView {
  rigId: string
  rigName: string
  snapshotId: string
  calculatedAt: string
  status: 'available' | 'site-unavailable' | 'no-darkness'
  night: { startsAt: string, endsAt: string, kind: 'current-night' | 'upcoming-night' | 'polar-night' } | null
  site: { latitudeDegrees: number, longitudeDegrees: number } | null
  siteUnavailableReason: string | null
  query: string
  category: TargetCategory | 'all'
  filter: TargetFilterChoice | 'all'
  offset: number
  pageSize: number
  total: number
  targets: TargetDiscoveryItem[]
}

export interface FramingView {
  rigId: string
  rigName: string
  enabled: boolean
  unavailableReason: string | null
  observedAt: string
  focalLengthMm: number | null
  camera: {
    name: string
    width: number
    height: number
    fieldWidthDegrees: number
    fieldHeightDegrees: number
  } | null
  phase: 'idle' | 'slewing' | 'exposing' | 'solving' | 'checked' | 'stopping' | 'stopped' | 'failed'
  active: boolean
  desired: TargetPosition | null
  targetId: string | null
  actual: (TargetPosition & {
    checkId: string
    capturedAt: string
    corners: TargetPosition[]
    rotationDegrees: number
    offsetArcminutes: number
  }) | null
  error: string | null
  exposureSeconds: number
  canCenter: boolean
  /** The last solved exposure still matches the observed rig/configuration. */
  checkCurrent: boolean
}
