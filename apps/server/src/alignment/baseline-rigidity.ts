import {
  cameraOrientation,
  rigidityVerdict,
  type Baseline,
  type BaselinePosition,
  type RigidityVerdict,
  type SolvedField,
} from '@vela/rig-sky'
import type { AlignmentSample } from './geometry.js'

/** One baseline position: its solve, the sample taken from it, and the right ascension the mount reported before the exposure. */
export interface RigidityFrame {
  solved: SolvedField
  sample: AlignmentSample
  mountRightAscensionDegrees: number
}

function position({ solved, sample, mountRightAscensionDegrees }: RigidityFrame): BaselinePosition {
  return {
    mountAngleDegrees: mountRightAscensionDegrees - sample.siderealTimeDegrees,
    orientation: cameraOrientation(solved, new Date(sample.capturedAt), sample.siderealTimeDegrees),
  }
}

/**
 * Whether the mount turned as one rigid body across the three baseline positions, so the three-point polar error can be trusted.
 * A solve whose WCS has no orientation (a singular CD matrix) throws: it is invalid data, and a miss that is not a number cannot be shown or recorded.
 */
export function baselineRigidity(frames: readonly [RigidityFrame, RigidityFrame, RigidityFrame]): RigidityVerdict {
  const [first, second, third] = frames
  const baseline: Baseline = [position(first), position(second), position(third)]

  const verdict = rigidityVerdict(baseline)

  if (!Number.isFinite(verdict.missArcmin)) throw new Error('A baseline solve has no usable orientation, so rigidity cannot be judged')

  return verdict
}
