import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MakeTime, RotateVector, Rotation_EQD_EQJ, Vector } from 'astronomy-engine'
import { diagnosticJournalName } from './diagnostic-schema.js'
import type { AlignmentMeasurement, AlignmentSample } from './geometry.js'

type Vec3 = readonly [number, number, number]

const radians = Math.PI / 180

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

function turn(vector: Vec3, axis: Vec3, degrees: number): Vec3 {
  const cosine = Math.cos(degrees * radians)
  const sine = Math.sin(degrees * radians)
  const along = dot(axis, vector) * (1 - cosine)
  const across = cross(axis, vector)

  const at = (i: 0 | 1 | 2) => vector[i] * cosine + across[i] * sine + axis[i] * along

  return [at(0), at(1), at(2)]
}

/**
 * What a plate solve of a rigid mount reports: the camera starts on the meridian pointing at `declinationDegrees`,
 * north up, and the mount turns it `mountAngleDegrees` about `axis`. `at` and `localSiderealDegrees` are the exposure
 * midpoint and the sidereal time there. This inverts `cameraOrientation`, so a sweep of these fields fits to `axis`.
 */
export function rigidField(axis: Vec3, mountAngleDegrees: number, declinationDegrees: number, at: Date, localSiderealDegrees: number) {
  const declination = declinationDegrees * radians
  const meridian = { pixelX: [0, 1, 0], pixelY: [-Math.sin(declination), 0, Math.cos(declination)], boresight: [Math.cos(declination), 0, Math.sin(declination)] } as const
  const camera = (direction: Vec3) => turn(direction, axis, mountAngleDegrees)
  const time = MakeTime(at)
  const precession = Rotation_EQD_EQJ(time)
  const sine = Math.sin(localSiderealDegrees * radians)
  const cosine = Math.cos(localSiderealDegrees * radians)

  const j2000 = (haFrame: Vec3): Vec3 => {
    const ofDate = new Vector(haFrame[0] * cosine - haFrame[1] * sine, haFrame[0] * sine + haFrame[1] * cosine, haFrame[2], time)
    const rotated = RotateVector(precession, ofDate)

    return [rotated.x, rotated.y, rotated.z]
  }

  const [pixelX, pixelY, boresight] = [meridian.pixelX, meridian.pixelY, meridian.boresight].map(direction => j2000(camera(direction)))
  const alpha = Math.atan2(boresight![1]!, boresight![0]!)
  const delta = Math.asin(boresight![2]!)
  const east: Vec3 = [-Math.sin(alpha), Math.cos(alpha), 0]
  const north: Vec3 = [-Math.sin(delta) * Math.cos(alpha), -Math.sin(delta) * Math.sin(alpha), Math.cos(delta)]
  const scale = 0.0004
  // A solve's CD has a negative determinant: pixel +x is east and pixel +y is north.
  const cd: [number, number, number, number] = [scale * dot(pixelX!, east), -scale * dot(pixelY!, east), scale * dot(pixelX!, north), -scale * dot(pixelY!, north)]

  return { raDegrees: ((alpha / radians) + 360) % 360, decDegrees: delta / radians, cd }
}

/** Adds the `baseline` entry that three-point journals held before plan step 34b. Nothing writes one now, but replay still reads them. */
export async function appendThreePointBaseline(
  directory: string,
  samples: readonly AlignmentSample[],
  latitudeDegrees: number,
  measurement: AlignmentMeasurement,
) {
  await appendFile(join(directory, diagnosticJournalName), `${JSON.stringify({ type: 'baseline', samples, latitudeDegrees, measurement })}\n`)
}
