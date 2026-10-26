/** Chosen observing intent, not evidence of pointing or a plate solution. */
export interface CaptureSubject {
  readonly targetId: string
  readonly name: string
  readonly catalog: string
}

/**
 * What a frame is for. Only `light` frames belong to a target; the rest calibrate lights
 * and carry no subject.
 */
export type FrameType = 'light' | 'dark' | 'flat' | 'dark-flat' | 'bias'

/** Conservative star measurements from this image's linear samples. */
export interface CaptureImageStatistics {
  detectedStars: number
  /** Median radius enclosing half a measured star's light, in native image pixels. */
  medianHfrPixels: number | null
}

/** The rig service's own ids for the request, operation and image that produced a frame. */
export interface CaptureImageProvenance {
  requestId: string
  /** Null when the rig service never admitted the request. */
  operationId: string | null
  /** Null until the operation produced an image. */
  imageId: string | null
}

/** Metadata belongs to this image, independent of any subsequent exposure. */
export interface CaptureImage {
  id: string
  /** Saved images from before frame types existed read as `light`. */
  frameType: FrameType
  /** Absent on legacy artifacts; null explicitly means no selected subject. Always null unless `light`. */
  subject?: CaptureSubject | null
  imageUrl: string
  /** Smaller display preview; imageUrl always retains native resolution. */
  fitImageUrl?: string
  width: number
  height: number
  exposureSeconds: number
  /** Exposure start, as reported by the acquisition boundary. */
  capturedAt: string
  /** Absent on legacy images means camera-reported; estimates use the server clock before exposure start. */
  capturedAtSource?: 'camera' | 'server-estimate'
  receivedAt: string
  cameraName: string
  color: 'mono' | 'color'
  /** Null means analysis was unavailable; zero detectedStars is a valid starless result. */
  statistics: CaptureImageStatistics | null
  /** Original data and preview have both been durably saved. */
  saved: boolean
  /** Absent on legacy artifacts, so unknown; null means the camera adapter carries no ids (Alpaca). */
  provenance?: CaptureImageProvenance | null
}

export interface SavedImage extends CaptureImage {
  rigId: string
  savedAt: string
  fitsUrl: string
  previewDownloadUrl: string
  /** Rendering state is separate from immutable capture facts; absent on older API fixtures. */
  previewRendering?:
    | { status: 'current'; version: 'background-v1' }
    | { status: 'legacy' }
    | { status: 'unavailable' }
}

export interface SavedImagesView {
  /** Vela server time zone used consistently for library nights and capture times. */
  timeZone: string
  rigId: string
  rigName: string
  images: SavedImage[]
}

export interface SavedImageView {
  /** Vela server time zone, matching the collection projection. */
  timeZone: string
  rigId: string
  rigName: string
  image: SavedImage
}

export type CapturePhase =
  | 'idle'
  | 'exposing'
  | 'reading'
  | 'saving'
  | 'stopping'
  | 'complete'
  | 'stopped'
  | 'failed'
  | 'interrupted'

/** Confirmed imaging-camera cooling. Sensor temperature near a setpoint does not mean the cooler is on. */
export interface CaptureCoolingView {
  readonly state: 'on' | 'off'
  readonly canSetTemperature: boolean
  readonly sensorTemperatureC?: number
  readonly setpointC?: number
  readonly powerPercent?: number
  /**
   * Rig work that currently owns device commands, so a cooling command would be
   * refused. `capture` is an active capture run; `rig` is any other short command;
   * a hold is a device whose last command has an unknown outcome.
   */
  readonly blockedBy?: CaptureCoolingBlocker
}

export type CaptureCoolingBlocker =
  | 'capture'
  | 'alignment'
  | 'autofocus'
  | 'framing'
  | 'rig'
  | { readonly kind: 'hold'; readonly reason: string }

/** Why a run ended without Chris stopping it or the camera failing, and what is left of it to take. */
export interface CaptureInterruption {
  /** Plain words, such as "Vela restarted". */
  reason: string
  /** Frames a resumed run would take; null when the run repeated until stopped, 0 when none are left. */
  remainingCount: number | null
}

/** Server-owned ephemeral capture run and the most recent retained image. */
export interface CaptureView {
  rigId: string
  rigName: string
  camera: { name: string } | null
  enabled: boolean
  unavailableReason: string | null
  phase: CapturePhase
  /** Interrupted reads of the same exposure; current does not imply image completion. */
  captureReadState: 'current' | 'retrying'
  active: boolean
  repeat: boolean
  /** What the current or most recent run takes; `light` before any run. */
  frameType: FrameType
  /** Frames after which the run ends by itself; null when it repeats until stopped. */
  frameCount?: number | null
  saveFrames: boolean
  savedImageCount: number | null
  /** Completed images published during the current or most recent run. */
  completedCount: number
  /** Frames that finished exposing but were lost before they could be fetched. */
  lostFrameCount?: number
  /** Snapshot of the selected subject for this run. */
  subject: CaptureSubject | null
  /** Images from this run durably retained, including explicit Keep. */
  savedCount: number
  /** Sum of exposure durations actually published during this run. */
  integrationSeconds: number
  exposureSeconds: number
  elapsedSeconds: number
  error: string | null
  /** Set while `phase` is `interrupted`: the run's settings and counts above are what it had done. */
  interruption?: CaptureInterruption | null
  latestImage: CaptureImage | null
  /** Null when the imaging camera does not report cooler state. */
  cooling: CaptureCoolingView | null
}
