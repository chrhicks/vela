import type { Confidence } from './belief.ts'
import type { RigModel } from './model.ts'
import { confidenceOf, lastFixOf, type MountPosition, type PointingFix } from './mount-position.ts'

// Step 3 AM5 profile: goto landing offset p90 7.02 arcsec, 30 landings, median 3.83 arcsec.
// Charge one p90 per blind degree as a conservative policy, not a measured sky-error slope.
// The 9x overshoot median is 4083.6 arcsec; observed travel includes that motion rather than the command alone.
export const blindErrorArcminPerDegree = 7.02 / 60

// A one-degree reference field reserves 2% for alignment and 5% for framing, following step 6's
// stricter alignment policy. These are pointing-budget choices, not conversions of plate-scale error.
export const confidencePolicy = [
  { maxBudgetArcmin: 60 * 0.02, confidence: 'high', reason: 'Alignment needs the smaller pointing budget, 2% of a one-degree field.' },
  { maxBudgetArcmin: 60 * 0.05, confidence: 'low', reason: 'Framing tolerates 5% of a one-degree field, but alignment needs a new solve.' },
  { maxBudgetArcmin: Infinity, confidence: 'none', reason: 'Above the framing budget, a new solve is needed before Aim can trust pointing.' },
] as const

export interface Assessment {
  readonly position: MountPosition
  readonly confidence: Confidence
  readonly budgetArcmin: number
  readonly blindTravelDegrees: number
  readonly lastFix: PointingFix | null
}

export function assess(model: RigModel): Assessment {
  const position = model.mount.value
  const lastFix = position.state === 'moving' ? lastFixOf(position.before) : lastFixOf(position)
  const budgetArcmin = lastFix === null ? Infinity : lastFix.errorArcmin.total + model.blindTravelDegrees * blindErrorArcminPerDegree
  const budgetConfidence = confidencePolicy.find(row => budgetArcmin <= row.maxBudgetArcmin)?.confidence ?? 'none'
  const stateConfidence = confidenceOf(position)

  const confidence = stateConfidence === 'none' || budgetConfidence === 'none' ? 'none'
    : stateConfidence === 'low' || budgetConfidence === 'low' ? 'low' : 'high'

  return { position, confidence, budgetArcmin, blindTravelDegrees: model.blindTravelDegrees, lastFix }
}
