import { SiderealTime } from 'astronomy-engine'
import { describe, expect, it } from 'vitest'
import { altitudeAt, noHorizon, type Horizon } from '../horizon/horizon.ts'
import { fromMount } from './coordinates.ts'
import { horizontalOfJ2000 } from './horizontal.ts'
import { moonPosition, placementOf, type UpLine } from './placement.ts'

const phoenix = { latitudeDegrees: 33.45, longitudeDegrees: -112.07, elevationMeters: 331 }
const at = Date.UTC(2026, 10, 15, 4, 0, 0)
const lineDegrees = 30
const upLine = (horizon: Horizon, stepSeconds = 60): UpLine => ({ horizon, upLineDegrees: lineDegrees, stepSeconds, lookAheadHours: 12 })
const flat = upLine(noHorizon)

const horizonOf = (altitudeDegrees: number, blocks: ReadonlyArray<{ readonly from: number; readonly to: number; readonly altitudeDegrees: number }> = []): Horizon => ({
  ...noHorizon,
  altitudesDegrees: noHorizon.altitudesDegrees.map((_, bin) => blocks.find(block => bin >= block.from && bin <= block.to)?.altitudeDegrees ?? altitudeDegrees),
})
const elsewhere = { raDegrees: 0, decDegrees: 0 }

const overheadAt = (when: number, hoursPastMeridian: number, decDegrees: number) => {
  const localSiderealHours = SiderealTime(new Date(when)) + phoenix.longitudeDegrees / 15

  return fromMount({ raDegrees: (((localSiderealHours - hoursPastMeridian) * 15) % 360 + 360) % 360, decDegrees }, new Date(when))
}

describe('where a target is in the sky', () => {
  it('is overhead when it crosses the meridian at the latitude of the site', () => {
    expect(placementOf(overheadAt(at, 0, phoenix.latitudeDegrees), phoenix, at, flat, elsewhere).altitudeDegrees).toBeCloseTo(90, 1)
  })

  it('says until when it stays above the line, and it is on the line at that time', () => {
    const target = overheadAt(at, 1, 20)
    const now = placementOf(target, phoenix, at, flat, elsewhere)

    expect(now.line.above).toBe('until')

    const until = now.line.above === 'until' ? now.line.until : at

    expect(until).toBeGreaterThan(at)
    expect(placementOf(target, phoenix, until, flat, elsewhere).altitudeDegrees).toBeCloseTo(lineDegrees, 1)
    expect(placementOf(target, phoenix, until - 600_000, flat, elsewhere).altitudeDegrees).toBeGreaterThan(lineDegrees)
  })

  it('is always above the line near the pole and never above it far south', () => {
    expect(placementOf(overheadAt(at, 5, 89), phoenix, at, flat, elsewhere).line).toEqual({ above: 'always' })
    expect(placementOf(overheadAt(at, 0, -60), phoenix, at, flat, elsewhere).line).toEqual({ above: 'no' })
  })

  it('says when a target still below the line rises to it, and it is on the line at that time', () => {
    const target = overheadAt(at, -6, 20)
    const rising = placementOf(target, phoenix, at, flat, elsewhere)

    expect(rising.altitudeDegrees).toBeLessThan(lineDegrees)
    expect(rising.line.above).toBe('rises')

    const rises = rising.line.above === 'rises' ? rising.line.at : at

    expect(rises).toBeGreaterThan(at)
    expect(placementOf(target, phoenix, rises, flat, elsewhere).altitudeDegrees).toBeCloseTo(lineDegrees, 1)
    expect(placementOf(target, phoenix, rises + 600_000, flat, elsewhere).line.above).toBe('until')
  })

  it('is not up once it has set below the line', () => {
    expect(placementOf(overheadAt(at, 6, 20), phoenix, at, flat, elsewhere).line).toEqual({ above: 'no' })
  })

  it('measures its distance from the Moon', () => {
    const target = { raDegrees: 100, decDegrees: 0 }

    expect(placementOf(target, phoenix, at, flat, target).moonDegrees).toBeCloseTo(0, 6)
    expect(placementOf(target, phoenix, at, flat, { raDegrees: 190, decDegrees: 0 }).moonDegrees).toBeCloseTo(90, 6)
  })

  it('finds the Moon opposite the Sun at a full Moon', () => {
    const fullMoon = Date.UTC(2026, 10, 24, 14, 53, 0)
    const moon = moonPosition(phoenix, fullMoon)
    const sunNearScorpius = { raDegrees: 240.2, decDegrees: -20.6 }

    expect(placementOf(sunNearScorpius, phoenix, fullMoon, flat, moon).moonDegrees).toBeGreaterThan(170)
  })

  it('is the same as a flat line at the up line when no azimuth is known', () => {
    const target = overheadAt(at, -6, 20)

    expect(placementOf(target, phoenix, at, flat, elsewhere).lineSource).toBe('up-line')
    expect(placementOf(target, phoenix, at, upLine(horizonOf(lineDegrees)), elsewhere).line).toEqual({ ...placementOf(target, phoenix, at, flat, elsewhere).line, lineSource: 'horizon' })
  })
})

describe('where a target is against the horizon at its azimuth', () => {
  const rising = overheadAt(at, -6, 20)
  const flatRise = placementOf(rising, phoenix, at, flat, elsewhere)
  const flatRiseAt = flatRise.line.above === 'rises' ? flatRise.line.at : at
  const riseAzimuth = horizontalOfJ2000(rising, flatRiseAt, phoenix).azimuthDegrees
  const eastBlock = [{ from: Math.floor(riseAzimuth) - 40, to: Math.ceil(riseAzimuth) + 40, altitudeDegrees: 40 }]

  it('rises later behind a block at its azimuth than over a flat line', () => {
    const behind = placementOf(rising, phoenix, at, upLine(horizonOf(10, eastBlock)), elsewhere)

    expect(flatRise.line.above).toBe('rises')
    expect(behind.line.above).toBe('rises')
    expect(behind.lineSource).toBe('horizon')
    expect(behind.lineDegrees).toBe(40)
    expect(behind.line.above === 'rises' ? behind.line.at : 0).toBeGreaterThan(flatRiseAt + 600_000)
  })

  it('is on the horizon at that azimuth at the time it rises, and below it a step before', () => {
    const horizon = horizonOf(10, eastBlock)
    const behind = placementOf(rising, phoenix, at, upLine(horizon), elsewhere)
    const riseAt = behind.line.above === 'rises' ? behind.line.at : at
    const place = (when: number) => horizontalOfJ2000(rising, when, phoenix)

    expect(place(riseAt).altitudeDegrees - (altitudeAt(horizon, place(riseAt).azimuthDegrees) ?? NaN)).toBeCloseTo(0, 1)
    expect(place(riseAt - 60_000).altitudeDegrees).toBeLessThan(altitudeAt(horizon, place(riseAt - 60_000).azimuthDegrees) ?? NaN)
    expect(place(riseAt + 60_000).altitudeDegrees).toBeGreaterThan(altitudeAt(horizon, place(riseAt + 60_000).azimuthDegrees) ?? NaN)
  })

  it('rises sooner over a horizon lower than the flat line', () => {
    const earlier = overheadAt(at, -7, 20)
    const flatEarlier = placementOf(earlier, phoenix, at, flat, elsewhere)
    const low = placementOf(earlier, phoenix, at, upLine(horizonOf(10)), elsewhere)

    expect(low.line.above).toBe('rises')
    expect(low.line.above === 'rises' ? low.line.at : at + 10 ** 12).toBeLessThan((flatEarlier.line.above === 'rises' ? flatEarlier.line.at : at) - 600_000)
  })

  it('is up at 20 degrees over a clear 10 degree south, and sets when it reaches the horizon', () => {
    const southern = overheadAt(at, 0, 20 - (90 - phoenix.latitudeDegrees))
    const clear = placementOf(southern, phoenix, at, upLine(horizonOf(10)), elsewhere)

    expect(clear.altitudeDegrees).toBeCloseTo(20, 1)
    expect(placementOf(southern, phoenix, at, flat, elsewhere).line.above).toBe('no')
    expect(clear.line.above).toBe('until')

    const until = clear.line.above === 'until' ? clear.line.until : at
    const there = horizontalOfJ2000(southern, until, phoenix)

    expect(until).toBeGreaterThan(at)
    expect(there.altitudeDegrees).toBeCloseTo(10, 1)
  })

  it('is not up at 20 degrees behind a 25 degree block', () => {
    const southern = overheadAt(at, -1, 20 - (90 - phoenix.latitudeDegrees))
    const blocked = placementOf(southern, phoenix, at, upLine(horizonOf(10, [{ from: 100, to: 260, altitudeDegrees: 25 }])), elsewhere)

    expect(blocked.line.above).toBe('no')
  })

  it('is up all night over a horizon it never goes below, and not up when it never rises over it', () => {
    expect(placementOf(overheadAt(at, 0, 80), phoenix, at, upLine(horizonOf(20)), elsewhere).line).toEqual({ above: 'always' })
    expect(placementOf(overheadAt(at, 0, -60), phoenix, at, upLine(horizonOf(10)), elsewhere).line).toEqual({ above: 'no' })
  })

  it('falls back to the up line where the horizon is unknown at its azimuth, and says so', () => {
    const unknownEast: Horizon = { ...noHorizon, altitudesDegrees: noHorizon.altitudesDegrees.map((_, bin) => (bin >= 200 ? 5 : null)) }
    const placed = placementOf(rising, phoenix, at, upLine(unknownEast), elsewhere)

    expect(placed.lineSource).toBe('up-line')
    expect(placed.lineDegrees).toBe(lineDegrees)
    expect(placed.line).toEqual(flatRise.line)
  })

  it('says which line it crossed, the horizon where it is mapped and the up line where it is not', () => {
    const mappedOnlyEast: Horizon = { ...noHorizon, altitudesDegrees: noHorizon.altitudesDegrees.map((_, bin) => (bin < 180 ? 40 : null)) }
    const crossed = placementOf(rising, phoenix, at, upLine(mappedOnlyEast), elsewhere)
    const flatCrossed = placementOf(rising, phoenix, at, flat, elsewhere)

    expect(crossed.line).toMatchObject({ above: 'rises', lineSource: 'horizon', lineDegrees: 40 })
    expect(flatCrossed.line).toMatchObject({ above: 'rises', lineSource: 'up-line', lineDegrees: lineDegrees })
  })

  it('finds a rise within one step of a finer search, whatever the step', () => {
    const horizon = horizonOf(10, eastBlock)
    const fine = placementOf(rising, phoenix, at, upLine(horizon, 5), elsewhere)
    const coarse = placementOf(rising, phoenix, at, upLine(horizon, 300), elsewhere)

    expect(fine.line.above).toBe('rises')
    expect(Math.abs((coarse.line.above === 'rises' ? coarse.line.at : 0) - (fine.line.above === 'rises' ? fine.line.at : 0))).toBeLessThan(60_000)
  })
})
