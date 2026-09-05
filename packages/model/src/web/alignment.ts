/** Server-owned, ephemeral polar-alignment state. Pixels and readings share a solve. */
export interface AlignmentView {
  rigId: string
  rigName: string
  enabled: boolean
  unavailableReason: string | null
  phase: 'setup' | 'baseline' | 'adjusting' | 'stopped' | 'finished' | 'failed'
  activity: 'idle' | 'exposing' | 'solving' | 'moving' | 'waiting' | 'stopping'
  active: boolean
  position: number
  solvedPositions: number
  exposureSeconds: number
  exposureStartedAt: string | null
  measuredAt: string | null
  warning: string | null
  error: string | null
  measurement: null | {
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
