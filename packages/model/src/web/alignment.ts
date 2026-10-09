/**
 * Display images of one exposure, positioned in native image pixels. The fit
 * image averages fitImageScale × fitImageScale native pixels per pixel, starting
 * at the origin; the native image is rendered on request for 100% inspection.
 * Images may become available after the exposure's correction is published.
 */
export interface AlignmentExposureImage {
  /** Identifies one acquired exposure across its correction and images. */
  frameId: string
  imageUrl: string
  imageWidth: number
  imageHeight: number
  fitImageUrl: string
  fitImageScale: number
}

/** The same native display pixels within a region around the reference and target. */
export interface AlignmentDetailImage {
  imageUrl: string
  x: number
  y: number
  width: number
  height: number
}

/** Server-owned, ephemeral polar-alignment state. Measurement pixels and readings share a solve. */
export interface AlignmentView {
  mode?: 'offline' | 'physical'
  cameraName?: string
  rigId: string
  rigName: string
  enabled: boolean
  unavailableReason: string | null
  phase: 'setup' | 'baseline' | 'adjusting' | 'stopped' | 'finished' | 'failed'
  activity:
    | 'idle'
    | 'exposing'
    | 'solving'
    | 'homing'
    | 'moving'
    | 'waiting'
    | 'retrying'
    | 'stopping'
  active: boolean
  position: number
  solvedPositions: number
  exposureSeconds: number
  exposureStartedAt: string | null
  measuredAt: string | null
  warning: string | null
  error: string | null
  /** Latest acquired frame, available even before a successful solve. */
  preview?: null | (AlignmentExposureImage & {
    capturedAt: string
    capturedAtSource?: 'camera' | 'server-estimate'
    position: number
  })
  measurement: null | (AlignmentExposureImage & {
    capturedAtSource?: 'camera' | 'server-estimate'
    altitudeArcsec: number
    azimuthArcsec: number
    totalArcsec: number
    /** When the plate solve completed; measuredAt remains the exposure start. */
    solvedAt: string
    targetX: number
    targetY: number
    fieldHeightDegrees: number
    /** Absent when the correction lies too far outside the image for useful detail. */
    detail?: AlignmentDetailImage
  })
}
