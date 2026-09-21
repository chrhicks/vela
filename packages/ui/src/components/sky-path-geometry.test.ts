import { describe, expect, it } from 'vitest'
import { angularSeparationDegrees, horizonAt, projectSky, visibleSkyPath } from './sky-path-geometry'

describe('overhead sky geometry', () => {
  it('puts east on the left and never folds below-horizon altitude into the dome', () => {
    expect(projectSky({ azimuthDegrees: 90, altitudeDegrees: 0 }, 100, 80).x).toBe(20)
    expect(projectSky({ azimuthDegrees: 0, altitudeDegrees: -20 }, 100, 80).y).toBeLessThan(20)
    expect(visibleSkyPath([{ azimuthDegrees: 0, altitudeDegrees: -20 }, { azimuthDegrees: 0, altitudeDegrees: -10 }], 100, 80)).toBe('')
    expect(visibleSkyPath([{ azimuthDegrees: 0, altitudeDegrees: -20 }, { azimuthDegrees: 0, altitudeDegrees: 20 }], 100, 80)).toBe('M100.00,20.00 L100.00,37.78')
  })

  it('preserves unknown sectors while interpolating known heights across north', () => {
    const points = [
      { azimuthDegrees: 30, altitudeDegrees: 20 },
      { azimuthDegrees: 120, altitudeDegrees: null },
      { azimuthDegrees: 240, altitudeDegrees: 10 },
      { azimuthDegrees: 330, altitudeDegrees: 10 }
    ]

    expect(horizonAt(points, 0)).toBe(15)
    expect(horizonAt(points, 90)).toBeNull()
    expect(horizonAt(points, 180)).toBeNull()
    expect(horizonAt(points, 280)).toBe(10)
  })
})

it('measures angular separation on the sphere rather than the flat dome', () => {
  expect(angularSeparationDegrees({ azimuthDegrees: 0, altitudeDegrees: 0 }, { azimuthDegrees: 90, altitudeDegrees: 0 })).toBeCloseTo(90)
  expect(angularSeparationDegrees({ azimuthDegrees: 0, altitudeDegrees: 60 }, { azimuthDegrees: 180, altitudeDegrees: 60 })).toBeCloseTo(60)
  expect(angularSeparationDegrees({ azimuthDegrees: 359, altitudeDegrees: 0 }, { azimuthDegrees: 1, altitudeDegrees: 0 })).toBeCloseTo(2)
})
