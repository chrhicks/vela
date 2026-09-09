/** Conservative star measurements from this image's linear samples. */
export interface CaptureImageStatistics {
  detectedStars: number
  /** Median radius enclosing half a measured star's light, in native image pixels. */
  medianHfrPixels: number | null
}

/** Metadata belongs to this image, independent of any subsequent exposure. */
export interface CaptureImage {
  id: string
  imageUrl: string
  /** Smaller display preview; imageUrl always retains native resolution. */
  fitImageUrl?: string
  width: number
  height: number
  exposureSeconds: number
  /** Exposure start, as reported by the acquisition boundary. */
  capturedAt: string
  receivedAt: string
  cameraName: string
  color: 'mono' | 'color'
  /** Null means analysis was unavailable; zero detectedStars is a valid starless result. */
  statistics: CaptureImageStatistics | null
  /** Original data and preview have both been durably saved. */
  saved: boolean
}

export interface SavedImage extends CaptureImage {
  rigId: string
  savedAt: string
  fitsUrl: string
  previewDownloadUrl: string
}

export interface SavedImagesView {
  rigId: string
  rigName: string
  images: SavedImage[]
}

export interface SavedImageView {
  rigId: string
  rigName: string
  image: SavedImage
}

export type CapturePhase = 'idle' | 'exposing' | 'reading' | 'saving' | 'stopping' | 'complete' | 'stopped' | 'failed'

/** Server-owned ephemeral capture run and the most recent retained image. */
export interface CaptureView {
  rigId: string
  rigName: string
  camera: { name: string } | null
  enabled: boolean
  unavailableReason: string | null
  phase: CapturePhase
  active: boolean
  repeat: boolean
  saveFrames: boolean
  savedImageCount: number | null
  /** Completed images published during the current or most recent run. */
  completedCount: number
  exposureSeconds: number
  elapsedSeconds: number
  error: string | null
  latestImage: CaptureImage | null
}
