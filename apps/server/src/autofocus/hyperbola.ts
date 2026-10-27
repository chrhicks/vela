export interface HyperbolaPoint {
  x: number
  y: number
  /** Inverse variance of `y`. A point without one counts as a well-measured sample, 100. */
  weight?: number
}

export interface HyperbolaFit {
  p: number
  a: number
  b: number
  rSquared: number
}

/** The spread of star HFRs never counts as tighter than this, so a few stars cannot look precise. */
const minStarSpreadPixels = 0.3

/**
 * How well a sample's median HFR is measured, as 1 / variance: the star count over the squared
 * robust spread (1.4826 × MAD) of the star table. A sample with no table is judged on its count
 * alone, and a single star gets 1 / 0.3² = 11 against 100 or more for a dozen stars.
 */
export function sampleWeight(detectedStars: number, starHfrs: number[]) {
  const sigma = Math.max(1.4826 * medianAbsoluteDeviation(starHfrs), minStarSpreadPixels)

  return detectedStars / sigma ** 2
}

function medianAbsoluteDeviation(values: number[]) {
  if (values.length < 2) return 0
  const center = median(values)

  return median(values.map(value => Math.abs(value - center)))
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)

  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/**
 * HFR(x) = a · √(1 + ((x − p) / b)²), fitted to the V around the lowest sample by weighted least
 * squares. Points with y < 0.1 are ignored. `rSquared` is the weighted R² on the V alone. Null
 * unless the V has five samples with at least one on each side of its lowest.
 */
export function fitHyperbola(points: HyperbolaPoint[]): HyperbolaFit | null {
  const finite = points.filter(
    point => Number.isFinite(point.x) && Number.isFinite(point.y) && point.y >= 0.1,
  )

  const v = vSamples(finite)

  if (!v || v.length < 5) return null
  const data: HyperbolaPoint[] = v
  const xs = data.map(point => point.x)
  const ys = data.map(point => point.y)
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const yMin = Math.min(...ys)
  const totalWeight = data.reduce((sum, point) => sum + weightOf(point), 0)
  const span = Math.max(xMax - xMin, 1)

  let best:
    | {
        p: number
        a: number
        b: number
        rSquared: number
        rms: number
      }
    | undefined

  function consider(p: number, a: number, b: number) {
    if (!(a > 0) || !(b > 0)) return
    let sum = 0

    for (const point of data) {
      const residual = point.y - hyperbola(point.x, a, b, p)
      sum += weightOf(point) * residual * residual
    }

    const rms = Math.sqrt(sum / totalWeight)

    if (!best || rms < best.rms) best = { p, a, b, rSquared: rSquared(data, a, b, p), rms }
  }

  search(
    xMin,
    xMax,
    yMin * 0.4,
    yMin * 1.15,
    Math.max(span / 40, 0.5),
    Math.max(span / 2, 1),
    21,
    13,
    13,
    consider,
  )

  if (!best) return null
  const coarse = best
  search(
    coarse.p - span / 20,
    coarse.p + span / 20,
    coarse.a * 0.85,
    coarse.a * 1.15,
    coarse.b * 0.7,
    coarse.b * 1.3,
    15,
    11,
    11,
    consider,
  )
  const refined = best
  const pLo = refined.p - Math.max(span / 80, 0.5)
  const pHi = refined.p + Math.max(span / 80, 0.5)
  const pSteps = 41

  for (let i = 0; i < pSteps; i++)
    consider(pLo + (i / (pSteps - 1)) * (pHi - pLo), refined.a, refined.b)

  return { p: best.p, a: best.a, b: best.b, rSquared: best.rSquared }
}

function weightOf(point: HyperbolaPoint) {
  return point.weight ?? 100
}

/**
 * The samples on the V: the lowest one and, on each side, the run outward from it that keeps
 * rising with defocus. Where HFR stops rising the measurement has stopped following the focus (the
 * recorded high side held 5.1 to 5.3 px over three samples), and a hyperbola dragged across that
 * flat stretch puts its vertex on the wrong side. A sample ends its side when it rises by less
 * than its error over the one before it, once that one stands well above the lowest, so noise at
 * the bottom of a wide curve never ends a side. Null when the lowest sample has no neighbour on a
 * side, that is when the window does not contain the minimum.
 */
function vSamples(points: HyperbolaPoint[]) {
  const sorted = [...points].sort((p, q) => p.x - q.x)
  const lowestIndex = sorted.reduce((best, point, i) => (point.y < sorted[best]!.y ? i : best), 0)
  const lowest = sorted[lowestIndex]!
  const below = risingRun(sorted.slice(0, lowestIndex).reverse(), lowest)
  const above = risingRun(sorted.slice(lowestIndex + 1), lowest)

  if (!below.length || !above.length) return null

  return [...below.reverse(), lowest, ...above]
}

function risingRun(outward: HyperbolaPoint[], lowest: HyperbolaPoint) {
  const kept: HyperbolaPoint[] = []
  let inner = lowest

  for (const point of outward) {
    const wellAbove = inner.y - lowest.y > 2 * errorBetween(inner, lowest)

    if (wellAbove && point.y - inner.y < errorBetween(point, inner)) break
    kept.push(point)
    inner = point
  }

  return kept
}

function errorBetween(a: HyperbolaPoint, b: HyperbolaPoint) {
  return Math.sqrt(1 / weightOf(a) + 1 / weightOf(b))
}

function search(
  pMin: number,
  pMax: number,
  aMin: number,
  aMax: number,
  bMin: number,
  bMax: number,
  pSteps: number,
  aSteps: number,
  bSteps: number,
  consider: (p: number, a: number, b: number) => void,
) {
  for (let pi = 0; pi < pSteps; pi++) {
    const p = pMin + (pi / Math.max(pSteps - 1, 1)) * (pMax - pMin)

    for (let ai = 0; ai < aSteps; ai++) {
      const a = aMin + (ai / Math.max(aSteps - 1, 1)) * (aMax - aMin)

      for (let bi = 0; bi < bSteps; bi++)
        consider(p, a, bMin + (bi / Math.max(bSteps - 1, 1)) * (bMax - bMin))
    }
  }
}

export function hyperbola(x: number, a: number, b: number, p: number) {
  return a * Math.sqrt(1 + ((x - p) / b) ** 2)
}

function rSquared(points: HyperbolaPoint[], a: number, b: number, p: number) {
  const totalWeight = points.reduce((sum, point) => sum + weightOf(point), 0)
  const mean = points.reduce((sum, point) => sum + weightOf(point) * point.y, 0) / totalWeight
  let ssTot = 0
  let ssRes = 0

  for (const point of points) {
    ssTot += weightOf(point) * (point.y - mean) ** 2
    ssRes += weightOf(point) * (point.y - hyperbola(point.x, a, b, p)) ** 2
  }

  if (!(ssTot > 0)) return 0

  return 1 - ssRes / ssTot
}
