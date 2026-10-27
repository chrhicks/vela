import type { CaptureImageStatistics } from './capture.js'

/** Catalog and framing positions are fixed J2000 equatorial degrees. */
export interface TargetPosition {
  raDegrees: number
  decDegrees: number
}

export interface TargetView extends TargetPosition {
  id: string
  name: string
  catalog: string
  constellation: string | null
  kind: string
  sizeArcminutes: number | null
  minorSizeArcminutes: number | null
  thumbnailUrl: string
  sky: TargetSkyPath | null
}

/**
 * Against the rig's approximate backyard horizon profile. `unknown` is a stretch the
 * survey could not trace: neither clear nor blocked.
 */
export type HorizonStatus = 'clear' | 'behind' | 'unknown'

/**
 * What a stretch of the horizon rests on. `observed` is a bin that stars dropped out in, higher than the
 * survey traced (or untraced): the skyline is at least the observed altitude there.
 */
export type HorizonBinKind = 'traced' | 'observed' | 'unknown'

/** Where the mount pointed when stars dropped out of a light run. */
export interface HorizonObservationView {
  id: string
  at: string
  altitudeDegrees: number
  azimuthDegrees: number
  strongBefore: number
  strongAt: number
  runId: string
}

/** Newest first. */
export interface HorizonObservationsView {
  rigId: string
  observations: HorizonObservationView[]
}

/** A horizon file exists but cannot be used, so the page shows no trees. Not a fault: nothing is blocked. */
export type HorizonProblem = 'unreadable'

/** Minutes of a window, counted in 15-minute sky samples, by horizon status. */
export interface HorizonWindow {
  checkedMinutes: number
  behindMinutes: number
  unknownMinutes: number
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
    /** Null when the rig has no horizon profile. */
    horizon: HorizonStatus | null
    /** The kind of horizon bin the sample falls in; null when the rig has no horizon profile. */
    horizonBin: HorizonBinKind | null
    sunAltitudeDegrees: number
    moon: {
      azimuthDegrees: number
      altitudeDegrees: number
      /** Illuminated fraction as seen from Earth's center, from 0 to 1. */
      illuminationFraction: number
      waxing: boolean
    }
  }>
  /** Position calculated at observedAt, independent of the sampled night span. */
  currentMoonSeparationDegrees: number
  currentAzimuthDegrees: number
  currentAltitudeDegrees: number
  highestAltitudeDegrees: number
  /** Set when the rig's horizon file or its observations file exists but cannot be read. */
  horizonProblem: HorizonProblem | null
  aboveHorizonDuringDarkness: Array<{ startsAt: string; endsAt: string }>
}

export interface TargetsView {
  rigId: string
  rigName: string
  targets: TargetView[]
  total: number
  site: { latitudeDegrees: number; longitudeDegrees: number } | null
  siteUnavailableReason: string | null
}

export type TargetCategory =
  | 'emission'
  | 'reflection-dark'
  | 'galaxy'
  | 'cluster'
  | 'planetary'
  | 'other'

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
  /** The opportunity window against the horizon profile; null without a profile or a window. Warn only. */
  horizonInWindow: HorizonWindow | null
}

/** A frozen calculation shared by every page and filter until explicit refresh. */
export interface TargetDiscoveryView {
  rigId: string
  rigName: string
  snapshotId: string
  calculatedAt: string
  status: 'available' | 'site-unavailable' | 'no-darkness'
  night: {
    startsAt: string
    endsAt: string
    kind: 'current-night' | 'upcoming-night' | 'polar-night'
  } | null
  site: { latitudeDegrees: number; longitudeDegrees: number } | null
  siteUnavailableReason: string | null
  query: string
  category: TargetCategory | 'all'
  filter: TargetFilterChoice | 'all'
  offset: number
  pageSize: number
  total: number
  targets: TargetDiscoveryItem[]
}

/** Catalog browsing has no inferred observing location or sky calculation. */
export type TargetCatalogItem = Omit<TargetDiscoveryItem, 'sky' | 'opportunity' | 'horizonInWindow'>

export interface TargetCatalogView {
  query: string
  category: TargetCategory | 'all'
  filter: TargetFilterChoice | 'all'
  offset: number
  pageSize: number
  total: number
  targets: TargetCatalogItem[]
}

/** Temporary pixels from one framing exposure, independently of its solve outcome. */
export interface FramingPreview {
  id: string
  rigId: string
  targetId: string
  width: number
  height: number
  exposureSeconds: number
  cameraName: string
  capturedAt: string
  capturedAtSource: 'camera' | 'server-estimate'
  checkId: string | null
  previewUrl: string | null
  nativePreviewUrl: string | null
  statistics: CaptureImageStatistics | null
}

export type FramingPointingSide = 'east' | 'west' | 'unknown'

/** Bounded measurements from one centering request, all against its fixed desired center. */
export interface FramingCentering {
  toleranceArcminutes: number
  maxCorrections: number
  correction: number
  outcome: 'working' | 'centered' | 'not-converging' | 'limit-reached' | 'interrupted'
  measurements: Array<{
    correction: number
    checkId: string
    capturedAt: string
    offsetArcminutes: number
    rotationDegrees: number
    pointingSide: FramingPointingSide
    pointingSideChanged: boolean
    trend: 'starting' | 'improved' | 'worsened' | 'unchanged' | 'within-tolerance'
  }>
}

export interface FramingView {
  /** Present when current mount facts identify a prerequisite recoverable in Your Rig. */
  mountControlReason?: 'parked' | 'tracking-off'
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
  phase:
    | 'idle'
    | 'slewing'
    | 'settling'
    | 'exposing'
    | 'downloading'
    | 'solving'
    | 'checked'
    | 'needs-check'
    | 'stopping'
    | 'stopped'
    | 'failed'
  /** Interrupted reads of the same exposure; current does not imply image completion. */
  captureReadState: 'current' | 'retrying'
  active: boolean
  /** Current readiness observation; unknown if inspection failed. Historical sides stay in measurements. */
  pointingSide: FramingPointingSide
  /** Present only with desired and targetId; measurements belong to that fixed composition. */
  centering: FramingCentering | null
  desired: TargetPosition | null
  targetId: string | null
  preview: FramingPreview | null
  actual:
    | (TargetPosition & {
        checkId: string
        capturedAt: string
        corners: TargetPosition[]
        rotationDegrees: number
        offsetArcminutes: number
      })
    | null
  error: string | null
  exposureSeconds: number
  /** A current solve can inform a user-requested correction to the edited composition. */
  canCenter: boolean
  /** The last solved exposure still matches the observed rig/configuration. */
  checkCurrent: boolean
}
