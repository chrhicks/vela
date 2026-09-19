export interface HyperbolaPoint {
  x: number
  y: number
}

export interface HyperbolaFit {
  p: number
  a: number
  b: number
  rSquared: number
}

/** HFR(x) = a · √(1 + ((x − p) / b)²). Points with y < 0.1 are ignored. */
export function fitHyperbola(points: HyperbolaPoint[]): HyperbolaFit | null {
  const data = points.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y) && point.y >= 0.1)

  if (data.length < 5) return null
  const xs = data.map(point => point.x)
  const ys = data.map(point => point.y)
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const yMin = Math.min(...ys)
  const span = Math.max(xMax - xMin, 1)

  let best: { p: number, a: number, b: number, rSquared: number, rms: number } | undefined

  function consider(p: number, a: number, b: number) {
    if (!(a > 0) || !(b > 0)) return
    let sum = 0

    for (const point of data) {
      const residual = point.y - hyperbola(point.x, a, b, p)
      sum += residual * residual
    }

    const rms = Math.sqrt(sum / data.length)

    if (!best || rms < best.rms) best = { p, a, b, rSquared: rSquared(data, a, b, p), rms }
  }

  search(xMin, xMax, yMin * 0.4, yMin * 1.15, Math.max(span / 40, 0.5), Math.max(span / 2, 1), 21, 13, 13, consider)

  if (!best) return null
  const coarse = best
  search(coarse.p - span / 20, coarse.p + span / 20, coarse.a * 0.85, coarse.a * 1.15, coarse.b * 0.7, coarse.b * 1.3, 15, 11, 11, consider)
  const refined = best
  const pLo = refined.p - Math.max(span / 80, 0.5)
  const pHi = refined.p + Math.max(span / 80, 0.5)
  const pSteps = 41

  for (let i = 0; i < pSteps; i++) consider(pLo + (i / (pSteps - 1)) * (pHi - pLo), refined.a, refined.b)

  return { p: best.p, a: best.a, b: best.b, rSquared: best.rSquared }
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

      for (let bi = 0; bi < bSteps; bi++) consider(p, a, bMin + (bi / Math.max(bSteps - 1, 1)) * (bMax - bMin))
    }
  }
}

export function hyperbola(x: number, a: number, b: number, p: number) {
  return a * Math.sqrt(1 + ((x - p) / b) ** 2)
}

function rSquared(points: HyperbolaPoint[], a: number, b: number, p: number) {
  const mean = points.reduce((sum, point) => sum + point.y, 0) / points.length
  let ssTot = 0
  let ssRes = 0

  for (const point of points) {
    ssTot += (point.y - mean) ** 2
    ssRes += (point.y - hyperbola(point.x, a, b, p)) ** 2
  }

  if (!(ssTot > 0)) return 0

  return 1 - ssRes / ssTot
}
