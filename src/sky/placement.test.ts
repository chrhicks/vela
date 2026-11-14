import { SiderealTime } from 'astronomy-engine'
import { describe, expect, it } from 'vitest'
import { fromMount } from './coordinates.ts'
import { moonPosition, placementOf } from './placement.ts'

const phoenix = { latitudeDegrees: 33.45, longitudeDegrees: -112.07, elevationMeters: 331 }
const at = Date.UTC(2026, 10, 15, 4, 0, 0)
const lineDegrees = 30
const elsewhere = { raDegrees: 0, decDegrees: 0 }

const overheadAt = (when: number, hoursPastMeridian: number, decDegrees: number) => {
  const localSiderealHours = SiderealTime(new Date(when)) + phoenix.longitudeDegrees / 15

  return fromMount({ raDegrees: (((localSiderealHours - hoursPastMeridian) * 15) % 360 + 360) % 360, decDegrees }, new Date(when))
}

describe('where a target is in the sky', () => {
  it('is overhead when it crosses the meridian at the latitude of the site', () => {
    expect(placementOf(overheadAt(at, 0, phoenix.latitudeDegrees), phoenix, at, lineDegrees, elsewhere).altitudeDegrees).toBeCloseTo(90, 1)
  })

  it('says until when it stays above the line, and it is on the line at that time', () => {
    const target = overheadAt(at, 1, 20)
    const now = placementOf(target, phoenix, at, lineDegrees, elsewhere)

    expect(now.line.above).toBe('until')

    const until = now.line.above === 'until' ? now.line.until : at

    expect(until).toBeGreaterThan(at)
    expect(placementOf(target, phoenix, until, lineDegrees, elsewhere).altitudeDegrees).toBeCloseTo(lineDegrees, 1)
    expect(placementOf(target, phoenix, until - 600_000, lineDegrees, elsewhere).altitudeDegrees).toBeGreaterThan(lineDegrees)
  })

  it('is always above the line near the pole and never above it far south', () => {
    expect(placementOf(overheadAt(at, 5, 89), phoenix, at, lineDegrees, elsewhere).line).toEqual({ above: 'always' })
    expect(placementOf(overheadAt(at, 0, -60), phoenix, at, lineDegrees, elsewhere).line).toEqual({ above: 'no' })
  })

  it('is not above the line while it is still rising toward it', () => {
    const rising = placementOf(overheadAt(at, -8, 20), phoenix, at, lineDegrees, elsewhere)

    expect(rising.line).toEqual({ above: 'no' })
    expect(rising.altitudeDegrees).toBeLessThan(lineDegrees)
  })

  it('measures its distance from the Moon', () => {
    const target = { raDegrees: 100, decDegrees: 0 }

    expect(placementOf(target, phoenix, at, lineDegrees, target).moonDegrees).toBeCloseTo(0, 6)
    expect(placementOf(target, phoenix, at, lineDegrees, { raDegrees: 190, decDegrees: 0 }).moonDegrees).toBeCloseTo(90, 6)
  })

  it('finds the Moon opposite the Sun at a full Moon', () => {
    const fullMoon = Date.UTC(2026, 10, 24, 14, 53, 0)
    const moon = moonPosition(phoenix, fullMoon)
    const sunNearScorpius = { raDegrees: 240.2, decDegrees: -20.6 }

    expect(placementOf(sunNearScorpius, phoenix, fullMoon, lineDegrees, moon).moonDegrees).toBeGreaterThan(170)
  })
})
