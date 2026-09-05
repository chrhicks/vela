/** Metadata belongs to this image, independent of any subsequent exposure. */
export interface CaptureImage {
  id: string
  imageUrl: string
  width: number
  height: number
  exposureSeconds: number
  /** Exposure start, as reported by the acquisition boundary. */
  capturedAt: string
  receivedAt: string
  cameraName: string
  color: 'mono' | 'color'
}

/** Server-owned single exposure and the most recent retained image. */
export interface CaptureView {
  rigId: string
  rigName: string
  camera: { name: string } | null
  enabled: boolean
  unavailableReason: string | null
  phase: 'idle' | 'exposing' | 'reading' | 'stopping' | 'complete' | 'stopped' | 'failed'
  active: boolean
  exposureSeconds: number
  elapsedSeconds: number
  error: string | null
  latestImage: CaptureImage | null
}
