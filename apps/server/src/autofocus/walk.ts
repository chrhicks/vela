export const DEFAULT_OFFSET_STEPS = 4

export const DEFAULT_STEP_SIZE = 50

/** The positions Vela may command, inclusive. Distinct from the planned autofocus window inside it. */
export interface FocuserTravel {
  min: number
  max: number
}

export interface AutofocusWalkPlan {
  start: number
  stepSize: number
  offsetSteps: number
  travel: FocuserTravel
  minPosition: number
  maxPosition: number
  positions: number[]
}

export type AutofocusWalkPlanning =
  | { ok: true; plan: AutofocusWalkPlan }
  | {
      ok: false
      reason: 'start-at-limit' | 'window-hits-limit' | 'invalid'
      message: string
    }

function commandableTravel(maxStep: number, minStep: number | undefined): FocuserTravel {
  return minStep === undefined
    ? { min: 1, max: maxStep - 1 }
    : { min: Math.max(minStep, 1), max: maxStep }
}

export function planStarHfrWalk(
  start: number,
  stepSize: number,
  offsetSteps: number,
  maxStep: number,
  minStep?: number,
): AutofocusWalkPlanning {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(stepSize) ||
    !Number.isSafeInteger(offsetSteps) ||
    !Number.isSafeInteger(maxStep) ||
    (minStep !== undefined && !Number.isSafeInteger(minStep))
  ) {
    return {
      ok: false,
      reason: 'invalid',
      message: 'Autofocus needs integer start, step size, offset and travel limits.',
    }
  }

  const travel = commandableTravel(maxStep, minStep)

  if (stepSize < 1 || offsetSteps < 1 || offsetSteps > 10 || travel.max < travel.min) {
    return {
      ok: false,
      reason: 'invalid',
      message: 'Step size and offset must fit a small window around the current focuser position.',
    }
  }

  if (start < travel.min || start > travel.max) {
    return {
      ok: false,
      reason: 'start-at-limit',
      message:
        'The focuser is outside the reported travel window. Vela will not move.',
    }
  }

  const maxPosition = start + offsetSteps * stepSize
  const minPosition = start - offsetSteps * stepSize

  if (minPosition < travel.min || maxPosition > travel.max) {
    return {
      ok: false,
      reason: 'window-hits-limit',
      message:
        'That step-size window would leave the focuser travel. Choose a smaller step or start farther from the ends. Vela will not move.',
    }
  }

  const positions: number[] = []

  for (let position = maxPosition; position >= minPosition; position -= stepSize)
    positions.push(position)

  return {
    ok: true,
    plan: { start, stepSize, offsetSteps, travel, minPosition, maxPosition, positions },
  }
}

export function assertCommandedPosition(
  position: number,
  plan: AutofocusWalkPlan,
  extraMin?: number,
) {
  if (position === 0) {
    throw new Error(
      'Focuser position 0 is a mechanical stop, not a home. Vela will not command Move(0).',
    )
  }

  if (
    !Number.isSafeInteger(position) ||
    position < plan.travel.min ||
    position > plan.travel.max
  ) {
    throw new Error('That focuser move is outside the focuser travel. Vela will not command it.')
  }

  const floor = extraMin ?? plan.minPosition

  if (position < floor || position > plan.maxPosition) {
    throw new Error(
      'That focuser move would leave the autofocus window around the starting position.',
    )
  }
}

/** One or two extra inward samples to close a V whose minimum is still at the inner edge. */
export function extraInwardPosition(
  plan: AutofocusWalkPlan,
  samples: { position: number; hfrPixels: number | null }[],
): number | undefined {
  if (samples.length >= plan.positions.length + 2) return undefined
  const measured = samples.filter(sample => sample.hfrPixels !== null)

  if (!measured.length) return undefined

  const lowest = measured.reduce((best, sample) =>
    sample.hfrPixels! < best.hfrPixels! ? sample : best,
  )

  const inner = Math.min(...samples.map(sample => sample.position))

  if (lowest.position !== inner) return undefined
  const next = inner - plan.stepSize
  const floor = plan.start - (plan.offsetSteps + 2) * plan.stepSize

  if (next < plan.travel.min || next < floor || next > plan.travel.max) return undefined

  return next
}
