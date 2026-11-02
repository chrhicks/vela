import type { TargetPosition } from './targets.js'

export interface ModelFixView {
  imageId: string
  at: number
  solvedJ2000: TargetPosition
  reportedJ2000: TargetPosition
  errorArcmin: { east: number; north: number; total: number }
  timeTrust: 'camera' | 'server-estimate'
}

export interface ModelSnapshotView {
  observedAt: number | null
  position: {
    state: 'known' | 'uncertain' | 'unknown' | 'moving'
    since: number
    reason: string
  }
  lastFix: ModelFixView | null
  fixes: ModelFixView[]
  fixCount: number
  rejectedCount: number
  skippedCount: number
}

export interface RigModelView {
  rigId: string
  checkedAt: number
  local: ModelSnapshotView | null
  shadow: { state: 'available' | 'unavailable'; checkpointAt: number | null; snapshot: ModelSnapshotView | null }
}
