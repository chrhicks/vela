import { describe, expect, it } from 'vitest'
import { fitHyperbola, hyperbola, sampleWeight } from './hyperbola.js'

describe('hyperbola focus fit', () => {
  it('recovers the vertex inside a sampled V and does not pick the min sample as the answer', () => {
    const p = 32838
    const a = 2.18
    const b = 95
    const positions = [33042, 32992, 32942, 32892, 32842, 32792, 32742, 32692, 32642]
    const points = positions.map(x => ({ x, y: hyperbola(x, a, b, p) }))
    const fit = fitHyperbola(points)

    expect(fit).not.toBeNull()
    expect(Math.round(fit!.p)).toBe(32838)
    expect(fit!.p).toBeGreaterThan(32800)
    expect(fit!.p).toBeLessThan(32880)
    expect(fit!.rSquared).toBeGreaterThan(0.99)
    const minSample = points.reduce((best, point) => (point.y < best.y ? point : best))
    expect(minSample.x).toBe(32842)
    expect(Math.round(fit!.p)).not.toBe(minSample.x)
  })

  it('ignores starless points and refuses a flat line', () => {
    expect(
      fitHyperbola([
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
        { x: 4, y: 0 },
        { x: 5, y: 0 },
      ]),
    ).toBeNull()
    const flat = [10, 20, 30, 40, 50, 60].map(x => ({ x, y: 2 }))
    const fit = fitHyperbola(flat)
    expect(!fit || fit.rSquared < 0.7).toBe(true)
  })

  const vertex = 32838
  const positions = [32642, 32692, 32742, 32792, 32842, 32892, 32942, 32992, 33042]
  const curve = (x: number) => hyperbola(x, 2.18, 70, vertex)

  it('does not let a flat stretch on one side pull the vertex toward it', () => {
    const plateau = curve(32942)

    const points = positions.map(x => ({
      x,
      y: x > 32942 ? plateau + (x - 32942) * 0.002 : curve(x),
    }))

    const fit = fitHyperbola(points)

    expect(fit).not.toBeNull()
    expect(Math.abs(fit!.p - vertex)).toBeLessThan(5)
    expect(fit!.rSquared).toBeGreaterThan(0.99)
  })

  it('counts a single star for far less than a dozen, and a scattered table for less than a tight one', () => {
    const tight = Array.from({ length: 12 }, (_, i) => 2.2 + (i % 3) * 0.1)
    const scattered = Array.from({ length: 12 }, (_, i) => 2.2 + (i % 4) * 0.8)

    expect(sampleWeight(1, [2.2])).toBeLessThan(sampleWeight(12, tight) / 5)
    expect(sampleWeight(12, scattered)).toBeLessThan(sampleWeight(12, tight) / 2)
    expect(sampleWeight(12, [])).toBe(sampleWeight(12, [2.2]))
  })

  it('moves less for a one-star sample that is off the curve than for a well-measured one', () => {
    const outlierAt = 32692
    const outlier = { x: outlierAt, y: curve(outlierAt) + 0.9 }
    const rest = positions.flatMap(x => (x === outlierAt ? [] : [{ x, y: curve(x) }]))
    const trusted = fitHyperbola([...rest, { ...outlier, weight: sampleWeight(12, [2.3, 2.4]) }])
    const doubted = fitHyperbola([...rest, { ...outlier, weight: sampleWeight(1, [outlier.y]) }])

    expect(trusted).not.toBeNull()
    expect(doubted).not.toBeNull()
    expect(Math.abs(doubted!.p - vertex)).toBeLessThan(Math.abs(trusted!.p - vertex))
  })

  it('gives no fit for noise around a flat line', () => {
    const noise = [0.1, -0.15, 0.05, 0.2, -0.1, -0.2, 0.15, 0, -0.05]
    const points = positions.map((x, i) => ({ x, y: 2.5 + noise[i]! }))

    expect(fitHyperbola(points)?.rSquared ?? 0).toBeLessThan(0.7)
  })

  it('gives no fit when the lowest sample is at the edge of the window', () => {
    const falling = positions.map(x => ({ x, y: 2 + (x - 32642) * 0.01 }))

    expect(fitHyperbola(falling)).toBeNull()
    expect(fitHyperbola([...falling].reverse())).toBeNull()
  })
})
