/** The coarse pass: 150 steps apart, 4 on each side of the start, so ±600. */
export const DEFAULT_STEP_SIZE = 150

export const DEFAULT_OFFSET_STEPS = 4

/** The fine pass: 25 steps apart, 6 on each side of the coarse minimum, so ±150. */
export const DEFAULT_FINE_STEP_SIZE = 25

export const DEFAULT_FINE_OFFSET_STEPS = 6

/** A confirm frame this much worse than the best fine-pass sample (0.1 is 10 %) sends the focuser back to that sample. */
export const DEFAULT_CONFIRM_TOLERANCE = 0.1

/**
 * How far past a final target the focuser goes before coming back down onto it. Must exceed the
 * focuser's backlash so the gear slack is always taken up the same way. A guess at several times
 * the EAF backlash we expect; not measured on this rig, so confirm on a real night.
 */
export const APPROACH_OVERSHOOT_STEPS = 300

/** The positions Vela may command, inclusive. Distinct from the planned autofocus window inside it. */
export interface FocuserTravel {
  min: number
  max: number
}

/** The coarse pass around the start: its window inside the travel, and its positions top first. */
export interface AutofocusWalkPlan {
  start: number
  stepSize: number
  offsetSteps: number
  travel: FocuserTravel
  minPosition: number
  maxPosition: number
  positions: number[]
}

/** The route of a run-ending move: pass through `via` (above the target), then come down onto `target`. */
export interface FinalApproach {
  target: number
  via: number | null
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
    plan: {
      start,
      stepSize,
      offsetSteps,
      travel,
      minPosition,
      maxPosition,
      positions,
    },
  }
}

/**
 * Every sample is taken after a downward move, so the curve describes the focuser as it sits after
 * coming down; a run-ending move comes down onto its target the same way. `via` is null only when the
 * target is at the top of travel and there is nowhere above it.
 */
export function approachFromAbove(travel: FocuserTravel, target: number): FinalApproach {
  const via = Math.min(target + APPROACH_OVERSHOOT_STEPS, travel.max)

  return { target, via: via > target ? via : null }
}

export function assertCommandedPosition(position: number, travel: FocuserTravel) {
  if (position === 0) {
    throw new Error(
      'Focuser position 0 is a mechanical stop, not a home. Vela will not command Move(0).',
    )
  }

  if (!Number.isSafeInteger(position) || position < travel.min || position > travel.max) {
    throw new Error('That focuser move is outside the focuser travel. Vela will not command it.')
  }
}
