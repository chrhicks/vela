export type Vec3 = readonly [number, number, number]

export type Matrix3 = readonly [Vec3, Vec3, Vec3]

export interface AxisAngle {
  readonly axis: Vec3
  readonly angleDegrees: number
}

/** Which way the camera points in the hour-angle frame: x on the meridian at the equator, y toward east, z at the pole. */
export interface CameraOrientation {
  readonly pixelX: Vec3
  readonly pixelY: Vec3
  readonly boresight: Vec3
}

export const radians = Math.PI / 180

export const arcminutesPerRadian = (180 / Math.PI) * 60

export const scale = (a: Vec3, factor: number): Vec3 => [a[0] * factor, a[1] * factor, a[2] * factor]

export const unit = (a: Vec3) => scale(a, 1 / Math.hypot(...a))

export const wrap180 = (degrees: number) => 180 - ((((180 - degrees) % 360) + 360) % 360)

export function rotationBetween(from: CameraOrientation, to: CameraOrientation): Matrix3 {
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
export function axisAngle(rotation: Matrix3): AxisAngle {
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
