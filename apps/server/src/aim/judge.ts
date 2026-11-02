import type { Bodies } from '@vela/rig-events'
import type { Assessment } from '@vela/rig-model'

export const aimPolicy = {
  toleranceArcmin: 0.5, // Framing's existing centering tolerance, including check-only goals.
  maxCorrections: 4, // Framing's existing correction limit.
  maxElapsedMs: 240_000, // C2's proposed four-minute Budget; shadow only, never a timeout.
  gotoWarningArcmin: 15, // Required audit threshold for a suspicious first-goto landing (SLEW-006).
}

export type AimResult = Bodies['aim']

export type AimEvent =
  | { kind: 'move'; correction: number }
  | { kind: 'solve'; verdict: 'accepted' | 'rejected'; residualArcmin: number | null }

export interface AimGoal {
  goalId: string
  target: { raDegrees: number; decDegrees: number }
  assessment: Pick<Assessment, 'confidence' | 'budgetArcmin' | 'blindTravelDegrees'> | null
  refusal: 'mount-unavailable' | 'mount-held' | 'outside-envelope' | null
  events: readonly AimEvent[]
  elapsedMs: number
  completed: boolean
}

export function judgeAim(goal: AimGoal): AimResult {
  const lastSolve = goal.events.at(-1)
  const firstLanding = goal.events.findIndex(event => event.kind === 'move' && event.correction === 0)
  const gotoSolve = firstLanding < 0 ? undefined : goal.events.slice(firstLanding + 1).find(event => event.kind === 'solve')
  const corrections = goal.events.filter(event => event.kind === 'move' && event.correction > 0).length
  const residualArcmin = lastSolve?.kind === 'solve' ? lastSolve.residualArcmin : null
  
  const numbers = {
    goalId: goal.goalId,
    target: goal.target,
    elapsedMs: goal.elapsedMs,
    corrections,
    residualArcmin,
    toleranceArcmin: aimPolicy.toleranceArcmin,
    maxCorrections: aimPolicy.maxCorrections,
    maxElapsedMs: aimPolicy.maxElapsedMs,
    gotoWarningArcmin: aimPolicy.gotoWarningArcmin,
    gotoMissArcmin: gotoSolve?.kind === 'solve' ? gotoSolve.residualArcmin : null,
    gotoWarning: gotoSolve?.kind === 'solve' && gotoSolve.residualArcmin !== null && gotoSolve.residualArcmin > aimPolicy.gotoWarningArcmin,
    confidence: goal.assessment?.confidence ?? 'none',
    // Step 25 supplies a pointing-error budget, not a time budget. Infinity means unknown.
    pointingBudgetArcmin: goal.assessment && Number.isFinite(goal.assessment.budgetArcmin) ? goal.assessment.budgetArcmin : null,
    blindTravelDegrees: goal.assessment?.blindTravelDegrees ?? null,
  }

  const refusal = goal.refusal ?? (!goal.assessment || goal.assessment.confidence === 'none' ? 'no-confidence' : null)

  if (refusal) return { ...numbers, status: 'refused', reason: refusal }

  if (goal.elapsedMs > aimPolicy.maxElapsedMs || corrections > aimPolicy.maxCorrections)
    return { ...numbers, status: 'missed', reason: 'budget' }

  if (!lastSolve || lastSolve.kind !== 'solve' || lastSolve.verdict === 'rejected' || residualArcmin === null)
    return { ...numbers, status: 'missed', reason: 'no-solve' }

  if (!goal.completed) return { ...numbers, status: 'missed', reason: 'interrupted' }

  if (residualArcmin > aimPolicy.toleranceArcmin)
    return { ...numbers, status: 'missed', reason: 'outside-tolerance' }

  return { ...numbers, status: 'aimed', reason: 'within-tolerance' }
}
