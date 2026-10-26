import { setImmediate } from 'node:timers/promises'

import type { StarRejection } from '@vela/model/web'

import type { ImageColor } from './preview.js'

type Background = { level: number; noise: number }

type Peak = { x: number; y: number }

/** A peak to measure. A blended peak is left unmeasured; with mergeBlends, blends merge into one. */
type Candidate = { peak: Peak; blended: boolean }

/** Why a star is left out of the count: the first gate it failed. */
export type Rejection = StarRejection

/** A passing star carries its half-flux radius and its flux signal-to-noise. */
export type Verdict = { ok: true; hfr: number; snr: number } | { ok: false; reason: Rejection }

/** The result of measuring a peak: the measurement, or why none could be formed. */
export type Measurement =
  | StarMeasurement
  | { ok: false; reason: Extract<Rejection, 'edge' | 'unconverged'> }

/** Everything measured around one peak, before any gate decides whether the star counts. */
export interface StarMeasurement {
  ok: true
  /** Background in the annulus around the star. */
  sky: Background
  /** Background-subtracted flux inside the aperture. */
  flux: number
  /** Background-subtracted flux between the aperture and the patch edge. */
  outerFlux: number
  /** Aperture pixels sharing the brightest value; many means a clipped plateau. */
  plateauPixels: number
  /** Second moments of the aperture flux: trace, and the separation of the principal axes. */
  trace: number
  separation: number
  /**
   * Ratio of the principal axes under a Gaussian window that adapts to the star, or null when the
   * moments are not valid. Computed on first call.
   */
  axisRatio: () => number | null
  /**
   * Half-flux radius in native pixels, or null when the enclosed flux has no half.
   * Computed on first call: it costs more than every other quantity together.
   */
  halfFluxRadius: () => number | null
}

export interface StarPolicy {
  aperture: number
  patchRadius: number
  isolation: number
  peakSigma: number
  peakWindow: number
  centroidRadius: number
  centroidWander: number
  annulusInner: number
  outerFluxFraction: number
  elongation: number
  /** Stars below this flux signal-to-noise are not judged on shape: the elongation gate lets them pass. */
  elongationMinSnr: number
  minHfrMono: number
  minHfrBayer: number
  mergeBlends: boolean
  /** Stars with at least this flux signal-to-noise get an axis ratio. */
  axisRatioMinSnr: number
}

/**
 * Stamped on every measurement so records from different revisions stay apart.
 * 1: unstamped records, with a Bayer capture HFR floor of 1.4 px. 2: that floor is 1.0 px.
 * 3: the elongation gate judges only capture stars with a flux signal-to-noise of `elongationMinSnr` or
 * more; fainter stars count with unknown shape.
 * The named outputs (detections, strong, rejected, sky, noise) are additive and leave the value of
 * every older field as it was, so they did not bump it.
 */
const starAlgorithmVersion = 3

/** A measured star with at least this flux signal-to-noise is strong. */
const strongSnr = 100

/**
 * A capture star with at least this flux signal-to-noise has its shape judged: it gets an axis ratio
 * and the elongation gate can reject it. Chosen when the moments used a hard aperture, whose noise
 * made a round star at S/N 30 to 60 read 1.5 on average and 50% of the stars there fail the gate on
 * a sharp frame. Windowed moments on synthetic stars are steadier: 90% of readings at S/N 35 lie
 * within 0.13 of the median. Lowering it is a bench question.
 */
const elongationMinSnr = 200

/**
 * The frame's axis ratio is recorded only from at least this many stars. On the 717 recorded
 * frames a median of 10 strong stars is within 0.06 of the frame's full median 19 times in 20, and
 * a median of 5 within 0.09. Only 2 of 631 light frames have 5 to 9 such stars, since a capture
 * frame has a median of 66.
 */
const minAxisRatioStars = 10

export const capturePolicy: StarPolicy = {
  aperture: 12,
  patchRadius: 16,
  isolation: 12,
  peakSigma: 8,
  peakWindow: 1,
  centroidRadius: 8,
  centroidWander: 3,
  annulusInner: 13,
  outerFluxFraction: 0.04,
  elongation: 0.65,
  elongationMinSnr,
  minHfrMono: 0.9,
  minHfrBayer: 1.0,
  mergeBlends: false,
  axisRatioMinSnr: elongationMinSnr,
}

export const autofocusPolicy: StarPolicy = {
  aperture: 40,
  patchRadius: 48,
  isolation: 48,
  peakSigma: 5,
  peakWindow: 2,
  centroidRadius: 28,
  centroidWander: 10,
  annulusInner: 41,
  outerFluxFraction: 0.4,
  elongation: 0.9,
  elongationMinSnr: 0,
  minHfrMono: 0.5,
  minHfrBayer: 0.8,
  mergeBlends: true,
  axisRatioMinSnr: Infinity,
}

/** Conservative measurements of isolated, adequately sampled stars in linear image data. */
export async function measureStars(
  width: number,
  height: number,
  pixels: ArrayLike<number>,
  color: ImageColor = { kind: 'mono' },
  policy: StarPolicy = capturePolicy,
) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 50_000_000 ||
    pixels.length !== width * height
  )
    throw new Error('Invalid image dimensions')

  // Every sample matters: invalid edges and unused Bayer pixels must not look starless.
  for (let index = 0; index < pixels.length; index++) {
    if (!Number.isFinite(pixels[index])) throw new Error('Image contains nonfinite samples')

    if (index % 131072 === 0) await setImmediate()
  }

  const { peaks, sky } = await findPeaks(width, height, pixels, color, policy)
  const verdicts: Verdict[] = []
  const axisRatios: number[] = []
  const candidates = groupPeaks(peaks, policy)

  for (let index = 0; index < candidates.length; index++) {
    const { peak, blended } = candidates[index]!

    if (blended) verdicts.push({ ok: false, reason: 'blended' })
    else {
      const measurement = measureStar(width, height, pixels, color, peak, policy)
      const axisRatio = axisRatioOf(measurement, policy)

      verdicts.push(classify(measurement, policy, color))

      if (axisRatio !== null) axisRatios.push(axisRatio)
    }

    if (index % 8 === 0) await setImmediate()
  }

  return summarize(verdicts, peaks.length, sky, axisRatios)
}

/** Defocus-capable HFR for an autofocus walk. Capture continues to use measureStars. */
export async function measureAutofocusStars(
  width: number,
  height: number,
  pixels: ArrayLike<number>,
  color: ImageColor = { kind: 'mono' },
) {
  return measureStars(width, height, pixels, color, autofocusPolicy)
}

/**
 * Local maxima above the sky that have neighbours, as positions in native image pixels, and the
 * frame's sky: the median level and noise of the tile backgrounds the peaks are judged against.
 */
export async function findPeaks(
  width: number,
  height: number,
  pixels: ArrayLike<number>,
  color: ImageColor,
  policy: StarPolicy,
): Promise<{ peaks: Peak[]; sky: Background }> {
  const scale = color.kind === 'bayer' ? 2 : 1

  const sample = (x: number, y: number) => {
    const index = y * scale * width + x * scale

    return scale === 1
      ? pixels[index]!
      : (pixels[index]! +
          pixels[index + 1]! +
          pixels[index + width]! +
          pixels[index + width + 1]!) /
          4
  }

  const columns = Math.floor(width / scale)
  const rows = Math.floor(height / scale)
  const tileSize = 64
  const tileColumns = Math.ceil(columns / tileSize)
  const backgrounds: Background[] = []

  for (let top = 0; top < rows; top += tileSize) {
    for (let left = 0; left < columns; left += tileSize) {
      const values: number[] = []

      for (let y = top; y < Math.min(rows, top + tileSize); y += 4) {
        for (let x = left; x < Math.min(columns, left + tileSize); x += 4) values.push(sample(x, y))
      }

      backgrounds.push(background(values))
    }

    await setImmediate()
  }

  const peaks: Peak[] = []
  const edge = policy.peakWindow

  for (let y = edge; y < rows - edge; y++) {
    for (let x = edge; x < columns - edge; x++) {
      const sky = backgrounds[Math.floor(y / tileSize) * tileColumns + Math.floor(x / tileSize)]!
      const value = sample(x, y)

      if (!(value > sky.level + policy.peakSigma * sky.noise)) continue
      let support = 0
      let maximum = true

      for (let dy = -edge; dy <= edge; dy++) {
        for (let dx = -edge; dx <= edge; dx++) {
          if (dx === 0 && dy === 0) continue
          const neighbor = sample(x + dx, y + dy)

          if (neighbor > value || (neighbor === value && (dy < 0 || (dy === 0 && dx < 0))))
            maximum = false

          if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && neighbor > sky.level + 3 * sky.noise)
            support++
        }
      }

      if (maximum && support >= 4) {
        peaks.push({
          x: x * scale + (scale - 1) / 2,
          y: y * scale + (scale - 1) / 2,
        })
      }
    }

    if (y % 32 === 0) await setImmediate()
  }

  return {
    peaks,
    sky: backgrounds.length
      ? {
          level: median(backgrounds.map(tile => tile.level)),
          noise: median(backgrounds.map(tile => tile.noise)),
        }
      : { level: 0, noise: 0 },
  }
}

function groupPeaks(peaks: Peak[], policy: StarPolicy): Candidate[] {
  if (policy.mergeBlends) {
    const candidates: Candidate[] = []
    const remaining = [...peaks]

    while (remaining.length) {
      const seed = remaining.pop()!
      const cluster = [seed]

      for (let index = remaining.length - 1; index >= 0; index--) {
        const candidate = remaining[index]!

        if (Math.hypot(candidate.x - seed.x, candidate.y - seed.y) < policy.isolation) {
          cluster.push(candidate)
          remaining.splice(index, 1)
        }
      }

      candidates.push({
        peak: {
          x: cluster.reduce((sum, peak) => sum + peak.x, 0) / cluster.length,
          y: cluster.reduce((sum, peak) => sum + peak.y, 0) / cluster.length,
        },
        blended: false,
      })
    }

    return candidates
  }

  // Spatial buckets keep blend rejection linear even in a rich field.
  const buckets = new Map<string, Peak[]>()

  for (const peak of peaks) {
    const key = `${Math.floor(peak.x / policy.isolation)},${Math.floor(peak.y / policy.isolation)}`
    const bucket = buckets.get(key) ?? []
    bucket.push(peak)
    buckets.set(key, bucket)
  }

  return peaks.map(peak => {
    const bx = Math.floor(peak.x / policy.isolation)
    const by = Math.floor(peak.y / policy.isolation)
    let blended = false

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const other of buckets.get(`${bx + dx},${by + dy}`) ?? []) {
          if (other !== peak && Math.hypot(other.x - peak.x, other.y - peak.y) < policy.isolation)
            blended = true
        }
      }
    }

    return { peak, blended }
  })
}

function signalToNoise({ flux, sky }: StarMeasurement, policy: StarPolicy) {
  return flux / (sky.noise * Math.sqrt(Math.PI * policy.aperture ** 2))
}

/** The gates before the elongation gate, in order: faint, saturated, wings. Null when the star passes them. */
function earlyRejection(measurement: StarMeasurement, policy: StarPolicy) {
  const { sky, flux, outerFlux, plateauPixels } = measurement

  if (!(flux > 30 * sky.noise * Math.sqrt(Math.PI * policy.aperture ** 2))) return 'faint'

  // Reject an obvious flat clipping plateau; sensor saturation levels are not assumed.
  if (plateauPixels >= 5) return 'saturated'

  if (Math.abs(outerFlux) > flux * policy.outerFluxFraction) return 'wings'

  return null
}

/**
 * The axis ratio of a star that reaches the elongation gate with at least `axisRatioMinSnr`, whether
 * or not the gate then rejects it: a trailed star must not drop out of the frame's axis ratio.
 * Null otherwise.
 */
export function axisRatioOf(measurement: Measurement, policy: StarPolicy) {
  if (!measurement.ok || earlyRejection(measurement, policy) !== null) return null

  return signalToNoise(measurement, policy) >= policy.axisRatioMinSnr ? measurement.axisRatio() : null
}

/**
 * The first gate the measurement fails, or the star's HFR when it passes them all. The elongation
 * gate applies only from `elongationMinSnr`: the moments of a fainter star are mostly noise.
 */
export function classify(
  measurement: Measurement,
  policy: StarPolicy,
  color: ImageColor,
): Verdict {
  if (!measurement.ok) return measurement
  const { trace, separation, halfFluxRadius } = measurement
  const early = earlyRejection(measurement, policy)

  if (early !== null) return { ok: false, reason: early }

  if (
    signalToNoise(measurement, policy) >= policy.elongationMinSnr &&
    (!(trace > 0) || separation > trace * policy.elongation)
  )
    return { ok: false, reason: 'elongated' }

  const hfr = halfFluxRadius()

  if (hfr === null) return { ok: false, reason: 'unconverged' }

  return hfr >= (color.kind === 'mono' ? policy.minHfrMono : policy.minHfrBayer)
    ? { ok: true, hfr, snr: signalToNoise(measurement, policy) }
    : { ok: false, reason: 'floor' }
}

/**
 * The frame's recorded statistics. `detectedStars` and `medianHfrPixels` are the stars that passed
 * every gate; the named outputs say how many peaks there were, how many were strong, why the rest
 * were left out, and what sky they stood on. `axisRatio` is the median over the stars that have one
 * and is null from fewer than `minAxisRatioStars` of them. With `mergeBlends`, merged peaks yield one
 * verdict.
 */
export function summarize(
  verdicts: Verdict[],
  detections: number,
  sky: Background,
  axisRatios: number[],
) {
  const radii: number[] = []
  let strong = 0

  const rejected: Record<Rejection, number> = {
    blended: 0,
    edge: 0,
    unconverged: 0,
    faint: 0,
    saturated: 0,
    wings: 0,
    elongated: 0,
    floor: 0,
  }

  for (const verdict of verdicts) {
    if (!verdict.ok) {
      rejected[verdict.reason]++
      continue
    }

    radii.push(verdict.hfr)

    if (verdict.snr >= strongSnr) strong++
  }

  return {
    algorithm: { version: starAlgorithmVersion },
    detectedStars: radii.length,
    medianHfrPixels: radii.length ? median(radii) : null,
    detections,
    measured: radii.length,
    strong,
    rejected,
    sky: sky.level,
    noise: sky.noise,
    axisRatio: axisRatios.length >= minAxisRatioStars ? median(axisRatios) : null,
  }
}

function median(values: number[]) {
  values.sort((a, b) => a - b)
  const middle = Math.floor(values.length / 2)

  return values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2
}

function background(values: number[]): Background {
  const finite = values.filter(Number.isFinite)

  if (!finite.length) return { level: NaN, noise: NaN }
  const level = median(finite)

  // A numerical floor permits noiseless floating-point fixtures without treating rounding as signal.
  const noise = Math.max(
    1.4826 * median(finite.map(value => Math.abs(value - level))),
    Math.max(1, Math.abs(level)) * 1e-9,
  )

  return { level, noise }
}

function luminance(
  width: number,
  pixels: ArrayLike<number>,
  color: ImageColor,
  x: number,
  y: number,
) {
  const value = (dx: number, dy: number) => pixels[(y + dy) * width + x + dx]!

  if (color.kind === 'mono') return value(0, 0)
  const channel = color.pattern[(y % 2) * 2 + (x % 2)]!
  const center = value(0, 0)

  if (channel === 'g') {
    const horizontal = (value(-1, 0) + value(1, 0)) / 2
    const vertical = (value(0, -1) + value(0, 1)) / 2

    return (center + horizontal + vertical) / 3
  }

  const green = (value(-1, 0) + value(1, 0) + value(0, -1) + value(0, 1)) / 4
  const opposite = (value(-1, -1) + value(1, -1) + value(-1, 1) + value(1, 1)) / 4

  return (center + green + opposite) / 3
}

/** Measures the star at a peak with no gate applied; fails only if no patch or centroid forms. */
export function measureStar(
  width: number,
  height: number,
  pixels: ArrayLike<number>,
  color: ImageColor,
  peak: Peak,
  policy: StarPolicy,
): Measurement {
  const ox = Math.round(peak.x)
  const oy = Math.round(peak.y)
  const { aperture, patchRadius } = policy

  if (
    ox <= patchRadius ||
    oy <= patchRadius ||
    ox >= width - patchRadius - 1 ||
    oy >= height - patchRadius - 1
  )
    return { ok: false, reason: 'edge' }
  const patch: { x: number; y: number; value: number }[] = []
  const annulus: number[] = []

  for (let y = -patchRadius; y <= patchRadius; y++) {
    for (let x = -patchRadius; x <= patchRadius; x++) {
      const value = luminance(width, pixels, color, ox + x, oy + y)

      if (!Number.isFinite(value)) return { ok: false, reason: 'unconverged' }
      patch.push({ x, y, value })

      if (Math.hypot(x, y) >= policy.annulusInner) annulus.push(value)
    }
  }

  const sky = background(annulus)
  let cx = 0
  let cy = 0

  for (let iteration = 0; iteration < 3; iteration++) {
    let flux = 0
    let mx = 0
    let my = 0

    for (const pixel of patch) {
      if (Math.hypot(pixel.x - cx, pixel.y - cy) > policy.centroidRadius) continue
      const signal = pixel.value - sky.level
      flux += signal
      mx += pixel.x * signal
      my += pixel.y * signal
    }

    if (!(flux > 0)) return { ok: false, reason: 'unconverged' }
    cx = mx / flux
    cy = my / flux

    if (Math.hypot(cx, cy) > policy.centroidWander) return { ok: false, reason: 'unconverged' }
  }

  let flux = 0
  let outerFlux = 0
  let mxx = 0
  let myy = 0
  let mxy = 0
  let maximum = -Infinity
  let plateauPixels = 0

  for (const pixel of patch) {
    const dx = pixel.x - cx
    const dy = pixel.y - cy
    const radius = Math.hypot(dx, dy)
    const signal = pixel.value - sky.level

    if (radius <= aperture) {
      flux += signal
      mxx += signal * dx * dx
      myy += signal * dy * dy
      mxy += signal * dx * dy

      if (pixel.value > maximum) {
        maximum = pixel.value
        plateauPixels = 1
      } else if (pixel.value === maximum) plateauPixels++
    } else if (radius <= patchRadius) outerFlux += signal
  }

  return {
    ok: true,
    sky,
    flux,
    outerFlux,
    plateauPixels,
    trace: mxx + myy,
    separation: Math.hypot(mxx - myy, 2 * mxy),
    axisRatio: once(() => windowedAxisRatio(patch, cx, cy, sky, patchRadius)),
    halfFluxRadius: once(() => halfFluxRadius(patch, cx, cy, sky, aperture)),
  }
}

/**
 * Ratio of the principal axes from second moments under a Gaussian window that follows the star
 * (adaptive moments). The window starts round and is reset each pass to twice the weighted
 * moments, which a Gaussian star in a window of its own form reproduces; a round window would pull
 * an elongated star toward 1, and the hard aperture's corners add noise to a bright one. Null when
 * the moments are not positive, the iteration does not settle, or the window outgrows the patch.
 */
function windowedAxisRatio(
  patch: { x: number; y: number; value: number }[],
  cx: number,
  cy: number,
  sky: Background,
  patchRadius: number,
): number | null {
  const largestVariance = (patchRadius / 3) ** 2
  // The window weighs a pixel by exp(-distance / 2); beyond this the weight is below 5e-5.
  const negligibleDistance = 20
  let wxx = 4
  let wyy = 4
  let wxy = 0
  let centerX = cx
  let centerY = cy

  for (let iteration = 0; iteration < 40; iteration++) {
    const determinant = wxx * wyy - wxy * wxy
    const ixx = wyy / determinant
    const iyy = wxx / determinant
    const ixy = -wxy / determinant
    let total = 0
    let sx = 0
    let sy = 0
    let sxx = 0
    let syy = 0
    let sxy = 0

    for (const pixel of patch) {
      const dx = pixel.x - centerX
      const dy = pixel.y - centerY
      const distance = ixx * dx * dx + 2 * ixy * dx * dy + iyy * dy * dy

      if (distance > negligibleDistance) continue
      const signal = Math.exp(-distance / 2) * (pixel.value - sky.level)
      total += signal
      sx += signal * dx
      sy += signal * dy
      sxx += signal * dx * dx
      syy += signal * dy * dy
      sxy += signal * dx * dy
    }

    if (!(total > 0)) return null
    const mx = sx / total
    const my = sy / total
    const mxx = sxx / total - mx * mx
    const myy = syy / total - my * my
    const mxy = sxy / total - mx * my
    const spread = Math.hypot((mxx - myy) / 2, mxy)
    const mean = (mxx + myy) / 2
    const minor = mean - spread

    if (!(minor > 0) || mean + spread > largestVariance / 2) return null

    const settled =
      Math.abs(2 * mxx - wxx) + Math.abs(2 * myy - wyy) + Math.abs(2 * mxy - wxy) <
        1e-3 * (wxx + wyy) && Math.hypot(mx, my) < 1e-3

    if (settled) return Math.sqrt((mean + spread) / minor)

    wxx = 2 * mxx
    wyy = 2 * myy
    wxy = 2 * mxy
    centerX += 2 * mx
    centerY += 2 * my
  }

  return null
}

function halfFluxRadius(
  patch: { x: number; y: number; value: number }[],
  cx: number,
  cy: number,
  sky: Background,
  aperture: number,
): number | null {
  // Each pixel contributes signed, background-subtracted flux across its actual square area.
  // A fine radial histogram gives circular enclosed flux, not a weighted mean star radius.
  const binsPerPixel = 32
  const subdivisions = 8
  const bins = new Float64Array(aperture * binsPerPixel + 1)

  for (const pixel of patch) {
    if (Math.hypot(pixel.x - cx, pixel.y - cy) > aperture + 1) continue
    const binFlux = (pixel.value - sky.level) / subdivisions ** 2

    for (let sy = 0; sy < subdivisions; sy++) {
      for (let sx = 0; sx < subdivisions; sx++) {
        const dx = pixel.x - cx + (sx + 0.5) / subdivisions - 0.5
        const dy = pixel.y - cy + (sy + 0.5) / subdivisions - 0.5
        const bin = Math.floor(Math.hypot(dx, dy) * binsPerPixel)

        if (bin < bins.length) bins[bin]! += binFlux
      }
    }
  }

  const total = bins.reduce((sum, binFlux) => sum + binFlux, 0)

  if (!(total > 0)) return null
  let enclosed = 0

  for (let bin = 0; bin < bins.length; bin++) {
    const binFlux = bins[bin]!

    if (enclosed + binFlux >= total / 2)
      return (bin + (total / 2 - enclosed) / binFlux) / binsPerPixel

    enclosed += binFlux
  }

  return null
}

function once<T>(compute: () => T): () => T {
  let result: { value: T } | undefined

  return () => (result ??= { value: compute() }).value
}
