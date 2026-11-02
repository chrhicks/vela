import type { AlignmentView } from '@vela/model/web'

/** Fixes in one sweep; the server's SWEEP_POSITIONS. */
export const POSITIONS = 6

export type PositionState = 'done' | 'dropped' | 'current' | 'pending'

type PositionView = Pick<AlignmentView, 'active' | 'position' | 'solvedPositions' | 'dropped'>

/** A position is past once the run has moved on from it, or once the run ended with all its fixes accounted for. */
export function positionState(view: PositionView, point: number): PositionState {
  if (view.dropped?.some(entry => entry.position === point)) return 'dropped'

  if (view.active && point === view.position) return 'current'

  const accounted = view.solvedPositions + (view.dropped?.length ?? 0)

  return point < view.position || (point === view.position && accounted >= point) ? 'done' : 'pending'
}
