import { rigidityVerdict, rigidMissArcmin, type BaselinePosition, type RigidityVerdict } from './rigidity.ts'
import { axisAngle, radians, rotationBetween, unit, wrap180, type Matrix3, type Vec3 } from './rotation.ts'

/** One solved frame of a sweep. `atSeconds` is on any clock the fixes share, and neighbouring fixes are the ones next in time. */
export interface SweepFix extends BaselinePosition {
  readonly label: string
  readonly atSeconds: number
}

/** Two neighbouring fixes whose camera turned more than the mount's own turn and a tilted axis explain. */
export interface SweepStep {
  readonly labelBefore: string
  readonly labelAfter: string
  readonly excessArcmin: number
  readonly baselineArcmin: number
  readonly turnDegrees: number
  readonly mountAngleBeforeDegrees: number
  readonly mountAngleAfterDegrees: number
}

export interface SweepVerdict extends RigidityVerdict {
  readonly steps: readonly SweepStep[]
}

export interface PolarFit {
  /** The mount's RA axis in the hour-angle frame, z up. It is not a number when the camera never turned. */
  readonly axis: Vec3
  /** Positive when the axis points higher than the pole, as Vela's polar alignment reports it. */
  readonly altitudeArcsec: number
  /** Positive when the axis points east of north. */
  readonly azimuthArcsec: number
  readonly totalArcsec: number
  /** The error above is a polar error only when this says rigid. */
  readonly verdict: SweepVerdict
}

export const minimumFixes = 5

/** A pair is a step when its excess is over `stepFactor` times what a tilted axis adds, plus this floor. */
export const stepFloorArcmin = 8

export const stepFactor = 1.5

const minimumTurnForRateDegrees = 0.2

const byTime = (fixes: readonly SweepFix[]) => fixes.toSorted((a, b) => a.atSeconds - b.atSeconds)

function median(values: readonly number[]) {
  if (values.length === 0) return 0

  const sorted = values.toSorted((a, b) => a - b)
  const middle = sorted.length >> 1

  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

function excessArcmin(before: SweepFix, after: SweepFix) {
  const turn = wrap180(after.mountAngleDegrees - before.mountAngleDegrees) * radians
  const cosine = Math.cos(turn)
  const sine = Math.sin(turn)
  const camera = rotationBetween(before.orientation, after.orientation)

  const row = (index: number): Vec3 => {
    const [x, y, z] = camera[index]!

    return [cosine * x - sine * y, sine * x + cosine * y, z]
  }

  const withoutIdealTurn: Matrix3 = [row(0), row(1), row(2)]

  return axisAngle(withoutIdealTurn).angleDegrees * 60
}

/**
 * Neighbouring fixes (in time order) whose excess rotation is more than a tilted axis alone explains: the
 * baseline for a pair is the series' median excess per degree times the pair's turn.
 */
export function findSteps(fixes: readonly SweepFix[]): SweepStep[] {
  const ordered = byTime(fixes)

  const pairs = ordered.slice(1).map((after, index) => {
    const before = ordered[index]!

    return { before, after, turnDegrees: wrap180(after.mountAngleDegrees - before.mountAngleDegrees), excess: excessArcmin(before, after) }
  })

  const rates = pairs.filter(pair => Math.abs(pair.turnDegrees) >= minimumTurnForRateDegrees).map(pair => pair.excess / Math.abs(pair.turnDegrees))
  const perDegree = median(rates)

  return pairs.flatMap(({ before, after, turnDegrees, excess }) => {
    const baseline = perDegree * Math.abs(turnDegrees)

    if (!(excess > stepFactor * baseline + stepFloorArcmin)) return []

    return {
      labelBefore: before.label,
      labelAfter: after.label,
      excessArcmin: excess,
      baselineArcmin: baseline,
      turnDegrees,
      mountAngleBeforeDegrees: before.mountAngleDegrees,
      mountAngleAfterDegrees: after.mountAngleDegrees,
    }
  })
}

/** Each pair of fixes votes for its rotation axis, and a wider turn fixes its axis better, so it counts sin² of half its angle. */
function meanAxis(fixes: readonly SweepFix[]): Vec3 {
  let sum: Vec3 = [0, 0, 0]

  fixes.forEach((first, index) => {
    for (const second of fixes.slice(index + 1)) {
      const { axis, angleDegrees } = axisAngle(rotationBetween(first.orientation, second.orientation))
      const weight = Math.sin((angleDegrees * radians) / 2) ** 2 * (axis[2] < 0 ? -1 : 1)

      sum = [sum[0] + axis[0] * weight, sum[1] + axis[1] * weight, sum[2] + axis[2] * weight]
    }
  })

  return unit(sum)
}

function widestTurnPair(fixes: readonly SweepFix[]) {
  const pairs = fixes.flatMap((first, i) =>
    fixes.slice(i + 1).map((second, offset) => ({ i, j: i + 1 + offset, turn: Math.abs(wrap180(second.mountAngleDegrees - first.mountAngleDegrees)) })),
  )

  return pairs.reduce((widest, pair) => (pair.turn > widest.turn ? pair : widest))
}

function sweepVerdict(fixes: readonly SweepFix[]): SweepVerdict {
  const { i, j } = widestTurnPair(fixes)
  const missArcmin = Math.max(...fixes.map(fix => rigidityVerdict([fixes[i]!, fixes[j]!, fix]).missArcmin))

  return { status: missArcmin < rigidMissArcmin ? 'rigid' : 'not-rigid', missArcmin, thresholdArcmin: rigidMissArcmin, steps: findSteps(fixes) }
}

function poleError(axis: Vec3, latitudeDegrees: number) {
  const latitude = latitudeDegrees * radians
  const altitude = Math.asin(Math.max(-1, Math.min(1, axis[0] * Math.cos(latitude) + axis[2] * Math.sin(latitude))))
  const azimuth = Math.atan2(axis[1], -axis[0] * Math.sin(latitude) + axis[2] * Math.cos(latitude))

  return {
    altitudeArcsec: (altitude / radians - latitudeDegrees) * 3600,
    azimuthArcsec: (azimuth / radians) * 3600,
    totalArcsec: (Math.atan2(Math.hypot(axis[0], axis[1]), axis[2]) / radians) * 3600,
  }
}

/**
 * Fits the mount's RA axis to the camera orientations of a sweep in RA and says whether the mount turned rigidly
 * while it swept, which decides whether the polar error can be trusted. It needs five fixes or more at different
 * mount angles, and throws a RangeError otherwise.
 */
export function fitPolarAxis(fixes: readonly SweepFix[], latitudeDegrees: number): PolarFit {
  if (fixes.length < minimumFixes) throw new RangeError(`A polar axis fit needs at least ${minimumFixes} fixes, got ${fixes.length}`)

  const ordered = byTime(fixes)
  const axis = meanAxis(ordered)

  return { axis, ...poleError(axis, latitudeDegrees), verdict: sweepVerdict(ordered) }
}
