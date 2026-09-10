/** Server-owned, ephemeral polar-alignment state. Pixels and readings share a solve. */
export interface AlignmentView {
  mode?: 'offline' | 'physical'
  cameraName?: string
  rigId: string
  rigName: string
  enabled: boolean
  unavailableReason: string | null
  phase: 'setup' | 'baseline' | 'adjusting' | 'stopped' | 'finished' | 'failed'
  activity: 'idle' | 'exposing' | 'solving' | 'homing' | 'moving' | 'waiting' | 'stopping'
  active: boolean
  position: number
  solvedPositions: number
  exposureSeconds: number
  exposureStartedAt: string | null
  measuredAt: string | null
  warning: string | null
  error: string | null
  measurement: null | {
    capturedAtSource?: 'camera' | 'server-estimate'
    altitudeArcsec: number
    azimuthArcsec: number
    totalArcsec: number
    imageUrl: string
    imageWidth: number
    imageHeight: number
    targetX: number
    targetY: number
    fieldHeightDegrees: number
  }
}
