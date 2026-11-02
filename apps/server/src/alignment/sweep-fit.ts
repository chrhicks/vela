import { cameraOrientation, type SolvedField, type SweepFix } from '@vela/rig-sky'
import type { AlignmentSample } from './geometry.js'

/** What a sweep position's journalled frame holds that the fit needs. The mount's right ascension is its own reading, or the simulator's pointing. */
export interface FixEvidence {
  sample: AlignmentSample
  solution: { wcs: SolvedField }
  physical?: { before: { rightAscensionDegrees: number } } | undefined
  offlinePointing?: { rightAscensionDegrees: number } | undefined
}

/** One solved frame of the sweep as the polar axis fit takes it. The label is the position, so a step names its poses by position. */
export function sweepFix(position: number, { sample, solution, physical, offlinePointing }: FixEvidence): SweepFix {
  const mountRightAscensionDegrees = physical?.before.rightAscensionDegrees ?? offlinePointing?.rightAscensionDegrees

  if (mountRightAscensionDegrees === undefined) throw new Error('A sweep fix has no mount right ascension')

  const capturedAt = new Date(sample.capturedAt)

  return {
    label: String(position),
    atSeconds: capturedAt.getTime() / 1000,
    mountAngleDegrees: mountRightAscensionDegrees - sample.siderealTimeDegrees,
    orientation: cameraOrientation(solution.wcs, capturedAt, sample.siderealTimeDegrees),
  }
}
