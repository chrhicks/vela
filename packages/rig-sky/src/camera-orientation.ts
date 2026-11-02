import { MakeTime, RotateVector, Rotation_EQJ_EQD, Vector } from 'astronomy-engine'
import type { CameraOrientation } from './rotation.ts'

type Vec3 = readonly [number, number, number]

/** What a plate solve says about one frame: the field centre in J2000 and the WCS matrix, in degrees per pixel. */
export interface SolvedField {
  readonly raDegrees: number
  readonly decDegrees: number
  readonly cd: readonly [number, number, number, number]
}

const radians = Math.PI / 180

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

const scale = (a: Vec3, factor: number): Vec3 => [a[0] * factor, a[1] * factor, a[2] * factor]

const minus = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]

const unit = (a: Vec3) => scale(a, 1 / Math.hypot(...a))

/**
 * Which way the camera pointed in the hour-angle frame, from a solve of the frame taken at `at` when the local
 * apparent sidereal time was `localSiderealDegrees`. The J2000 solve is moved to the true equator of date, the
 * frame that sidereal time belongs to. The hour-angle frame has x on the meridian at the equator, y toward east and z at
 * the pole, so it holds no site. The axes are the +x pixel direction, the +y pixel direction and the boresight.
 * A mirrored WCS (negative determinant) flips the +y axis so the three stay a right-handed rotation; the other
 * two are unaffected.
 */
export function cameraOrientation(field: SolvedField, at: Date, localSiderealDegrees: number): CameraOrientation {
  const alpha = field.raDegrees * radians
  const delta = field.decDegrees * radians
  const east: Vec3 = [-Math.sin(alpha), Math.cos(alpha), 0]
  const north: Vec3 = [-Math.sin(delta) * Math.cos(alpha), -Math.sin(delta) * Math.sin(alpha), Math.cos(delta)]
  const boresight: Vec3 = [Math.cos(delta) * Math.cos(alpha), Math.cos(delta) * Math.sin(alpha), Math.sin(delta)]
  const [c11, c12, c21, c22] = field.cd
  const pixelX = unit([c11 * east[0] + c21 * north[0], c11 * east[1] + c21 * north[1], c11 * east[2] + c21 * north[2]])
  const tilted: Vec3 = [c12 * east[0] + c22 * north[0], c12 * east[1] + c22 * north[1], c12 * east[2] + c22 * north[2]]
  const pixelY = scale(unit(minus(tilted, scale(pixelX, dot(tilted, pixelX)))), c11 * c22 - c12 * c21 < 0 ? -1 : 1)

  const time = MakeTime(at)
  const precession = Rotation_EQJ_EQD(time)
  const sine = Math.sin(localSiderealDegrees * radians)
  const cosine = Math.cos(localSiderealDegrees * radians)

  const hourAngleFrame = (direction: Vec3): Vec3 => {
    const ofDate = RotateVector(precession, new Vector(direction[0], direction[1], direction[2], time))

    return [ofDate.x * cosine + ofDate.y * sine, -ofDate.x * sine + ofDate.y * cosine, ofDate.z]
  }

  return { pixelX: hourAngleFrame(pixelX), pixelY: hourAngleFrame(pixelY), boresight: hourAngleFrame(boresight) }
}
