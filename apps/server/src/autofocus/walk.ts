export const DEFAULT_OFFSET_STEPS = 4

export const DEFAULT_STEP_SIZE = 50

/** Commanded positions stay strictly inside (0, maxStep). 0 is a stop, not a home. */
export const MECHANICAL_END_MARGIN = 1

export interface AutofocusWalkPlan {
  start: number
  stepSize: number
  offsetSteps: number
  maxStep: number
  minPosition: number
  maxPosition: number
  positions: number[]
}

export type AutofocusWalkPlanning =
  | { ok: true, plan: AutofocusWalkPlan }
  | {
    ok: false
    reason: 'start-at-limit' | 'window-hits-limit' | 'invalid'
    message: string
  }

export function planStarHfrWalk(
  start: number,
  stepSize: number,
  offsetSteps: number,
  maxStep: number,
): AutofocusWalkPlanning {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(stepSize) || !Number.isSafeInteger(offsetSteps) || !Number.isSafeInteger(maxStep)) {
    return {
      ok: false,
      reason: 'invalid',
      message: 'Autofocus needs integer start, step size, offset and MaxStep.',
    }
  }

  if (stepSize < 1 || offsetSteps < 1 || offsetSteps > 10 || maxStep < 2) {
    return {
      ok: false,
      reason: 'invalid',
      message: 'Step size and offset must fit a small window around the current focuser position.',
    }
  }

  const mechanicalMin = MECHANICAL_END_MARGIN
  const mechanicalMax = maxStep - MECHANICAL_END_MARGIN

  if (start < mechanicalMin || start > mechanicalMax) {
    return {
      ok: false,
      reason: 'start-at-limit',
      message: 'The focuser is already at a mechanical limit. Autofocus starts from the current position and will not command 0 or MaxStep.',
    }
  }

  const maxPosition = start + offsetSteps * stepSize
  const minPosition = start - offsetSteps * stepSize

  if (minPosition < mechanicalMin || maxPosition > mechanicalMax) {
    return {
      ok: false,
      reason: 'window-hits-limit',
      message: 'That step-size window would approach 0 or MaxStep. Choose a smaller step or start farther from the ends. Vela will not move.',
    }
  }

  const positions: number[] = []

  for (let position = maxPosition; position >= minPosition; position -= stepSize) positions.push(position)

  return {
    ok: true,
    plan: { start, stepSize, offsetSteps, maxStep, minPosition, maxPosition, positions },
  }
}

export function assertCommandedPosition(position: number, plan: AutofocusWalkPlan, extraMin?: number) {
  if (position === 0) {
    throw new Error('Focuser position 0 is a mechanical stop, not a home. Vela will not command Move(0).')
  }

  if (!Number.isSafeInteger(position) || position < MECHANICAL_END_MARGIN || position > plan.maxStep - MECHANICAL_END_MARGIN) {
    throw new Error('That focuser move would approach a mechanical travel limit. Vela will not command it.')
  }

  const floor = extraMin ?? plan.minPosition

  if (position < floor || position > plan.maxPosition) {
    throw new Error('That focuser move would leave the autofocus window around the starting position.')
  }
}

/** One or two extra inward samples to close a V whose minimum is still at the inner edge. */
export function extraInwardPosition(
  plan: AutofocusWalkPlan,
  samples: { position: number, hfrPixels: number | null }[],
): number | undefined {
  if (samples.length >= plan.positions.length + 2) return undefined
  const measured = samples.filter(sample => sample.hfrPixels !== null)

  if (!measured.length) return undefined
  const lowest = measured.reduce((best, sample) => sample.hfrPixels! < best.hfrPixels! ? sample : best)
  const inner = Math.min(...samples.map(sample => sample.position))

  if (lowest.position !== inner) return undefined
  const next = inner - plan.stepSize
  const floor = plan.start - (plan.offsetSteps + 2) * plan.stepSize

  if (next < MECHANICAL_END_MARGIN || next < floor || next > plan.maxStep - MECHANICAL_END_MARGIN) return undefined

  return next
}
