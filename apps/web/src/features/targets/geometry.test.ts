import { describe, expect, it } from 'vitest'
import { frameCorners, offsetPosition } from './geometry'

describe('camera tangent plane geometry', () => {
  it.each([
    [3, 1],
    [30, 10],
  ])('keeps a %s × %s degree rotated field rectangular on its camera plane', (width, height) => {
    const center = { raDegrees: 359.9, decDegrees: 82 }
    const angle = (32 * Math.PI) / 180
    const points = frameCorners(center, width, height, 32)
    // Forward-project the corners independently to recover the camera axes.
    const r = Math.PI / 180
    const d0 = center.decDegrees * r

    const plane = points.map(p => {
      const da = (p.raDegrees - center.raDegrees) * r
      const d = p.decDegrees * r
      const denominator = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(da)
      const x = (Math.cos(d) * Math.sin(da)) / denominator

      const y =
        (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(da)) / denominator

      return [
        Math.atan(x * Math.cos(angle) + y * Math.sin(angle)) / r,
        Math.atan(-x * Math.sin(angle) + y * Math.cos(angle)) / r,
      ]
    })

    expect(points.some(p => p.raDegrees < 180)).toBe(true)

    for (const [x, y] of plane) {
      expect(Math.abs(x!)).toBeCloseTo(width / 2, 8)
      expect(Math.abs(y!)).toBeCloseTo(height / 2, 8)
    }

    expect(offsetPosition(center, 0, 0)).toEqual(center)
  })
})
