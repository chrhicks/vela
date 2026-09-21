export type Vector = readonly [number, number, number]

export interface CameraPose {
  readonly direction: Vector
  readonly right: Vector
  readonly up: Vector
}

export interface MountPosition {
  readonly latitudeDegrees: number
  readonly altitudeErrorDegrees: number
  readonly azimuthErrorDegrees: number
  readonly raAxisDegrees: number
  readonly declinationDegrees: number
  readonly elapsedSeconds: number
  readonly tracking: boolean
}

const radians = Math.PI / 180

export const siderealRadiansPerSecond = (2 * Math.PI) / 86164.0905

/** Ideal rigid mount in a fixed equatorial frame; sidereal angle is zero at t=0. */
export function cameraPose(position: MountPosition): CameraPose {
  validatePosition(position)
  const declination = position.declinationDegrees * radians

  const spin =
    position.raAxisDegrees * radians -
    (position.tracking ? position.elapsedSeconds * siderealRadiansPerSecond : 0)

  const transform = (vector: Vector) => toSky(rotate(vector, [0, 0, 1], spin), position)

  return {
    direction: transform([Math.cos(declination), 0, Math.sin(declination)]),
    right: transform([0, 1, 0]),
    up: transform([-Math.sin(declination), 0, Math.cos(declination)]),
  }
}

export function polarAxis(position: MountPosition): Vector {
  validatePosition(position)

  return toSky([0, 0, 1], position)
}

function toSky(vector: Vector, position: MountPosition): Vector {
  const latitude = position.latitudeDegrees * radians
  const zenith: Vector = [Math.cos(latitude), 0, Math.sin(latitude)]
  const tilted = rotate(vector, [0, 1, 0], position.altitudeErrorDegrees * radians)
  const adjusted = rotate(tilted, zenith, -position.azimuthErrorDegrees * radians)

  return rotate(adjusted, [0, 0, 1], position.elapsedSeconds * siderealRadiansPerSecond)
}

function rotate(v: Vector, axis: Vector, angle: number): Vector {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const d = axis[0] * v[0] + axis[1] * v[1] + axis[2] * v[2]

  return [
    v[0] * c + (axis[1] * v[2] - axis[2] * v[1]) * s + axis[0] * d * (1 - c),
    v[1] * c + (axis[2] * v[0] - axis[0] * v[2]) * s + axis[1] * d * (1 - c),
    v[2] * c + (axis[0] * v[1] - axis[1] * v[0]) * s + axis[2] * d * (1 - c),
  ]
}

function validatePosition(position: MountPosition) {
  for (const value of [
    position.latitudeDegrees,
    position.altitudeErrorDegrees,
    position.azimuthErrorDegrees,
    position.raAxisDegrees,
    position.declinationDegrees,
    position.elapsedSeconds,
  ]) {
    if (!Number.isFinite(value)) throw new Error('Mount position must contain finite numbers')
  }

  if (
    Math.abs(position.latitudeDegrees) > 90 ||
    Math.abs(position.declinationDegrees) > 90 ||
    Math.abs(position.altitudeErrorDegrees) > 5 ||
    Math.abs(position.azimuthErrorDegrees) > 5 ||
    position.elapsedSeconds < 0 ||
    (position.tracking !== true && position.tracking !== false)
  ) {
    throw new Error('Mount position is outside the supported simulation range')
  }
}
