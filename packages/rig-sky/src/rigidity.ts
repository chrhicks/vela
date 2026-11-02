type Vec3 = readonly [number, number, number]

type Matrix3 = readonly [Vec3, Vec3, Vec3]

interface AxisAngle {
  readonly axis: Vec3
  readonly angleDegrees: number
}

/** Which way the camera points in the hour-angle frame: x on the meridian at the equator, y toward east, z at the pole. */
export interface CameraOrientation {
  readonly pixelX: Vec3
  readonly pixelY: Vec3
  readonly boresight: Vec3
}

export interface BaselinePosition {
  /** The mount's own turn angle: its reported RA minus local sidereal time. */
  readonly mountAngleDegrees: number
  readonly orientation: CameraOrientation
}

export type Baseline = readonly [BaselinePosition, BaselinePosition, BaselinePosition]

export interface RigidityVerdict {
  readonly status: 'rigid' | 'not-rigid'
  readonly missArcmin: number
  readonly thresholdArcmin: number
}

/**
 * The mount-rigidity tool calls a miss under 2 arcmin rigid: a rigid mount scores under 0.1 on a synthetic
 * baseline and 0.1 to 1.5 on the rig's recorded ones, and a loose mount scores 15 to 40. The tool also names
 * 2 to 10 "marginal". A polar number is trusted only when the mount was rigid, so marginal is not rigid here.
 */
export const rigidMissArcmin = 2

const radians = Math.PI / 180

const arcminutesPerRadian = (180 / Math.PI) * 60

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

const scale = (a: Vec3, factor: number): Vec3 => [a[0] * factor, a[1] * factor, a[2] * factor]

const unit = (a: Vec3) => scale(a, 1 / Math.hypot(...a))

const wrap180 = (degrees: number) => 180 - ((((180 - degrees) % 360) + 360) % 360)

function rotationBetween(from: CameraOrientation, to: CameraOrientation): Matrix3 {
  const columns = [
    [from.pixelX, to.pixelX],
    [from.pixelY, to.pixelY],
    [from.boresight, to.boresight],
  ] as const

  const entry = (row: number, column: number) =>
    columns.reduce((sum, [before, after]) => sum + after[row]! * before[column]!, 0)

  const row = (index: number): Vec3 => [entry(index, 0), entry(index, 1), entry(index, 2)]

  return [row(0), row(1), row(2)]
}

/** A zero rotation has no axis, and its caller turns by zero. Half a turn has two; either one works. */
function axisAngle(rotation: Matrix3): AxisAngle {
  const sine: Vec3 = [
    (rotation[2][1] - rotation[1][2]) / 2,
    (rotation[0][2] - rotation[2][0]) / 2,
    (rotation[1][0] - rotation[0][1]) / 2,
  ]

  const sineLength = Math.hypot(...sine)
  const cosine = (rotation[0][0] + rotation[1][1] + rotation[2][2] - 1) / 2
  const angleDegrees = Math.atan2(sineLength, cosine) / radians

  if (sineLength > 1e-12) return { axis: scale(sine, 1 / sineLength), angleDegrees }

  if (cosine > 0) return { axis: [0, 0, 1], angleDegrees: 0 }

  const diagonal = [rotation[0][0], rotation[1][1], rotation[2][2]]
  const widest = diagonal.indexOf(Math.max(...diagonal))

  const half = (row: number) => (rotation[row]![widest]! + (row === widest ? 1 : 0)) / 2

  return { axis: unit([half(0), half(1), half(2)]), angleDegrees: 180 }
}

function rotate(vector: Vec3, axis: Vec3, angleDegrees: number): Vec3 {
  const cosine = Math.cos(angleDegrees * radians)
  const sine = Math.sin(angleDegrees * radians)
  const along = scale(axis, dot(axis, vector) * (1 - cosine))
  const across = scale(cross(axis, vector), sine)
  const kept = scale(vector, cosine)

  return [kept[0] + across[0] + along[0], kept[1] + across[1] + along[1], kept[2] + across[2] + along[2]]
}

/**
 * Whether the mount turned as one rigid body between the three positions, so the three-point polar error can be
 * trusted. Positions 1 and 2 give the camera's rotation per degree of mount turn about one fixed axis. That
 * rotation, applied to the mount's reported turn from 2 to 3, predicts where the camera points at 3. The miss
 * is how far the measured boresight is from the prediction. Only the ratio of the two turns enters, so the
 * mount's turn sign does not matter. Three points always fit one circle, so the fit alone cannot say this.
 *
 * A miss that is not a number (a corrupt solve) is not rigid.
 */
export function rigidityVerdict(baseline: Baseline): RigidityVerdict {
  const [first, second, third] = baseline
  const firstTurn = wrap180(second.mountAngleDegrees - first.mountAngleDegrees)
  const secondTurn = wrap180(third.mountAngleDegrees - second.mountAngleDegrees)

  if (Math.abs(firstTurn) < 1e-6) throw new RangeError('Positions 1 and 2 must differ in mount angle')

  const { axis, angleDegrees } = axisAngle(rotationBetween(first.orientation, second.orientation))
  const predicted = rotate(second.orientation.boresight, axis, (angleDegrees / firstTurn) * secondTurn)
  const cosine = Math.max(-1, Math.min(1, dot(predicted, third.orientation.boresight)))
  const missArcmin = Math.acos(cosine) * arcminutesPerRadian

  return { status: missArcmin < rigidMissArcmin ? 'rigid' : 'not-rigid', missArcmin, thresholdArcmin: rigidMissArcmin }
}
