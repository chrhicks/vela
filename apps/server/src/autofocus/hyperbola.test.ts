import { describe, expect, it } from 'vitest'
import { fitHyperbola, hyperbola } from './hyperbola.js'

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
})
