/** Ideal northern equatorial mount geometry. Inputs must share one fixed celestial
 * frame and the corresponding local sidereal angle; no epoch conversion is implied. */
export interface AlignmentSample {
  raDegrees: number
  decDegrees: number
  capturedAt: string
  siderealTimeDegrees: number
}

export interface AlignmentMeasurement {
  altitudeArcsec: number
  azimuthArcsec: number
  totalArcsec: number
  correctionTarget: { raDegrees: number, decDegrees: number }
}

type Vector = readonly [number, number, number]

export interface AlignmentBaseline {
  readonly latitudeDegrees: number
  readonly reference: AlignmentSample
  readonly nominalDirection: Vector
  readonly measurement: AlignmentMeasurement
}

const rad = Math.PI / 180

const pole: Vector = [0, 0, 1]

const east: Vector = [0, 1, 0]

export function createAlignmentBaseline(
  samples: readonly [AlignmentSample, AlignmentSample, AlignmentSample],
  latitudeDegrees: number,
): AlignmentBaseline {
  if (!Number.isFinite(latitudeDegrees) || latitudeDegrees <= 0 || latitudeDegrees >= 85) {
    throw new Error('Alignment requires a northern latitude between 0 and 85 degrees')
  }

  const points = samples.map(localDirection)
  const first = difference(points[1]!, points[0]!)
  const second = difference(points[2]!, points[0]!)
  const normal = cross(first, second)

  // Tiny baselines amplify plate-solve noise into an arbitrary pole estimate.
  if (length(first) < 0.01 || length(second) < 0.01 || length(normal) < 0.0001) {
    throw new Error('The three solved positions do not provide a usable rotation baseline')
  }

  let axis = scale(normal, 1 / length(normal))

  if (axis[2] < 0) axis = scale(axis, -1)
  const errors = axisErrors(axis, latitudeDegrees)
  assertFiniteAngles(errors.altitudeArcsec, errors.azimuthArcsec)
  const reference = { ...samples[2] }

  const nominalDirection = unadjust(
    points[2]!,
    errors.altitudeArcsec * rad / 3600,
    errors.azimuthArcsec * rad / 3600,
    latitudeDegrees,
  )

  return {
    latitudeDegrees,
    reference,
    nominalDirection,
    measurement: {
      ...errors,
      correctionTarget: coordinates(rotate(nominalDirection, pole, reference.siderealTimeDegrees * rad)),
    },
  }
}

/** Recover two physical adjustment angles from one new sightline. The mount may
 * track sidereally, but must not slew or change declination after the baseline. */
export function measureAlignment(
  baseline: AlignmentBaseline,
  sample: AlignmentSample,
  tracking: boolean,
): AlignmentMeasurement {
  const observed = localDirection(sample)
  const angle = tracking ? -(sample.siderealTimeDegrees - baseline.reference.siderealTimeDegrees) * rad : 0
  const nominal = rotate(baseline.nominalDirection, pole, angle)
  let altitude = baseline.measurement.altitudeArcsec * rad / 3600
  let azimuth = baseline.measurement.azimuthArcsec * rad / 3600
  // Azimuth rotation preserves elevation. Its altitude inverse has two branches;
  // keep the branch connected to the baseline rather than accepting a second root.
  const initialSensitivity = altitudeSensitivity(nominal, altitude, baseline.latitudeDegrees)
  const step = 1e-6

  for (let iteration = 0; iteration < 12; iteration++) {
    const predicted = adjust(nominal, altitude, azimuth, baseline.latitudeDegrees)
    const residual = difference(observed, predicted)

    const a = scale(
      difference(adjust(nominal, altitude + step, azimuth, baseline.latitudeDegrees), predicted),
      1 / step,
    )

    const b = scale(
      difference(adjust(nominal, altitude, azimuth + step, baseline.latitudeDegrees), predicted),
      1 / step,
    )

    const aa = dot(a, a)
    const ab = dot(a, b)
    const bb = dot(b, b)
    const determinant = aa * bb - ab * ab

    if (determinant < 1e-6) throw new Error('This sightline cannot distinguish altitude and azimuth adjustments')
    const ar = dot(a, residual)
    const br = dot(b, residual)
    const deltaAltitude = (ar * bb - br * ab) / determinant
    const deltaAzimuth = (br * aa - ar * ab) / determinant
    altitude += deltaAltitude
    azimuth += deltaAzimuth
    assertFiniteAngles(altitude / rad * 3600, azimuth / rad * 3600)

    if (initialSensitivity * altitudeSensitivity(nominal, altitude, baseline.latitudeDegrees) <= 0) {
      throw new Error('The adjustment calculation crossed an ambiguous sightline geometry; start a new baseline')
    }

    if (Math.hypot(deltaAltitude, deltaAzimuth) < 1e-10) break
  }

  if (length(difference(adjust(nominal, altitude, azimuth, baseline.latitudeDegrees), observed)) > 1e-7) {
    throw new Error('The new sightline does not fit the adjustment baseline')
  }

  const axis = adjust(pole, altitude, azimuth, baseline.latitudeDegrees)

  return {
    ...axisErrors(axis, baseline.latitudeDegrees),
    correctionTarget: coordinates(rotate(nominal, pole, sample.siderealTimeDegrees * rad)),
  }
}

function localDirection(sample: AlignmentSample): Vector {
  if (![sample.raDegrees, sample.decDegrees, sample.siderealTimeDegrees].every(Number.isFinite)
    || sample.raDegrees < 0 || sample.raDegrees >= 360 || Math.abs(sample.decDegrees) > 90
    || sample.siderealTimeDegrees < 0 || sample.siderealTimeDegrees >= 360
    || !Number.isFinite(Date.parse(sample.capturedAt))) {
    throw new Error('Invalid alignment sample')
  }

  const ra = (sample.raDegrees - sample.siderealTimeDegrees) * rad
  const dec = sample.decDegrees * rad

  return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)]
}

function axisErrors(axis: Vector, latitudeDegrees: number) {
  const latitude = latitudeDegrees * rad
  const altitude = Math.asin(Math.max(-1, Math.min(1, axis[0] * Math.cos(latitude) + axis[2] * Math.sin(latitude))))
  const azimuth = Math.atan2(axis[1], -axis[0] * Math.sin(latitude) + axis[2] * Math.cos(latitude))

  return {
    altitudeArcsec: (altitude / rad - latitudeDegrees) * 3600,
    azimuthArcsec: azimuth / rad * 3600,
    totalArcsec: Math.atan2(Math.hypot(axis[0], axis[1]), axis[2]) / rad * 3600,
  }
}

function assertFiniteAngles(altitude: number, azimuth: number) {
  if (![altitude, azimuth].every(value => Number.isFinite(value))) {
    throw new Error('The adjustment calculation produced non-finite angles; start a new baseline')
  }
}

function altitudeSensitivity(nominal: Vector, altitude: number, latitude: number): number {
  const tilted = rotate(nominal, east, altitude)

  return dot(cross(east, tilted), zenith(latitude))
}

function zenith(latitudeDegrees: number): Vector {
  return [Math.cos(latitudeDegrees * rad), 0, Math.sin(latitudeDegrees * rad)]
}

function adjust(vector: Vector, altitude: number, azimuth: number, latitude: number): Vector {
  return rotate(rotate(vector, east, altitude), zenith(latitude), -azimuth)
}

function unadjust(vector: Vector, altitude: number, azimuth: number, latitude: number): Vector {
  return rotate(rotate(vector, zenith(latitude), azimuth), east, -altitude)
}

function coordinates(v: Vector) {
  return {
    raDegrees: (Math.atan2(v[1], v[0]) / rad + 360) % 360,
    decDegrees: Math.atan2(v[2], Math.hypot(v[0], v[1])) / rad,
  }
}

function rotate(v: Vector, axis: Vector, angle: number): Vector {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const perpendicular = cross(axis, v)
  const along = dot(axis, v) * (1 - c)

  return [
    v[0] * c + perpendicular[0] * s + axis[0] * along,
    v[1] * c + perpendicular[1] * s + axis[1] * along,
    v[2] * c + perpendicular[2] * s + axis[2] * along,
  ]
}

function dot(a: Vector, b: Vector) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }

function cross(a: Vector, b: Vector): Vector {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function difference(a: Vector, b: Vector): Vector { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }

function scale(a: Vector, s: number): Vector { return [a[0] * s, a[1] * s, a[2] * s] }

function length(a: Vector) { return Math.hypot(...a) }
