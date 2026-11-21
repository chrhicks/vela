import { SiderealTime } from 'astronomy-engine'
import { describe, expect, it } from 'vitest'
import { footprintOf, type SkyPlace } from '../../state/horizon-frame.ts'
import { noHorizon, type Horizon } from '../horizon/horizon.ts'
import { fromMount } from './coordinates.ts'
import { nightTimes } from './darkness.ts'
import { footprintAt, frameNight, lowestClearance, type FrameNightInput } from './frame-night.ts'
import { lineAt, type HorizonLine } from './path.ts'

const phoenix = { latitudeDegrees: 33.45, longitudeDegrees: -112.07, elevationMeters: 331 }
const radians = Math.PI / 180
const minuteMs = 60_000
const afternoon = Date.UTC(2026, 10, 15, 22, 0, 0)
const night = nightTimes(phoenix, afternoon)!
const middle = Math.round((night.darkAt! + night.darkEndsAt!) / 2)

const separation = (from: SkyPlace, to: SkyPlace) => {
  const half = (degrees: number) => Math.sin((degrees * radians) / 2) ** 2

  return (2 * Math.asin(Math.min(1, Math.sqrt(half(from.altitudeDegrees - to.altitudeDegrees) + Math.cos(from.altitudeDegrees * radians) * Math.cos(to.altitudeDegrees * radians) * half(from.azimuthDegrees - to.azimuthDegrees))))) / radians
}

const transitingAt = (when: number, decDegrees: number) => fromMount({ raDegrees: ((((SiderealTime(new Date(when)) + phoenix.longitudeDegrees / 15) * 15) % 360) + 360) % 360, decDegrees }, new Date(when))

const horizonOf = (blocks: ReadonlyArray<{ readonly from: number; readonly to: number; readonly altitudeDegrees: number }>, floor: number | null = 0): Horizon => ({
  ...noHorizon,
  altitudesDegrees: noHorizon.altitudesDegrees.map((_, bin) => blocks.find(block => bin >= block.from && bin <= block.to)?.altitudeDegrees ?? floor),
})

const lineOf = (horizon: Horizon): HorizonLine => ({ horizon, upLineDegrees: 30 })

const input = (overrides: Partial<FrameNightInput> = {}): FrameNightInput => ({
  target: transitingAt(middle, 0),
  site: phoenix,
  night,
  line: lineOf(horizonOf([])),
  stepSeconds: 60,
  angleDecimals: 1,
  cameraAngleDegrees: undefined,
  edgeSamples: 16,
  ...overrides,
})

describe("the camera's footprint placed on the sky", () => {
  const spots = [-60, -20, 5, 40, 70, 85].flatMap(decDegrees => [0, 60, 130, 200, 300].flatMap(raDegrees => [0, 3, 6, 9].map(hours => ({ target: { raDegrees, decDegrees }, at: Date.UTC(2026, 10, 15, 6 + hours, 0, 0) }))))
  const angles = [undefined, 37.5, 0, 90, 135]

  const worstGap = (rounded: boolean) => {
    let worst = 0
    let compared = 0

    for (const { target, at } of spots) {
      for (const angle of angles) {
        const exact = footprintAt(target, phoenix, at, angle, 8)

        if (exact.centre.altitudeDegrees < 5) continue

        const centre = rounded ? { azimuthDegrees: Math.round(exact.centre.azimuthDegrees * 100) / 100, altitudeDegrees: Math.round(exact.centre.altitudeDegrees * 100) / 100 } : exact.centre
        const north = rounded ? Math.round(exact.northAngleDegrees * 10) / 10 : exact.northAngleDegrees

        footprintOf(centre, north, angle ?? null, 8).forEach((point, index) => {
          worst = Math.max(worst, separation(point, exact.outline[index]!))
          compared += 1
        })
      }
    }

    expect(compared).toBeGreaterThan(1000)

    return worst
  }

  it("matches the exact projection through the sky to a millionth of a degree from the exact inputs, and 0.01 degrees from the answer's rounded ones", () => {
    expect(worstGap(false)).toBeLessThan(1e-6)
    expect(worstGap(true)).toBeLessThan(0.01)
  })

  it('is the same outline when the camera is turned half a way round', () => {
    const target = { raDegrees: 130, decDegrees: 20 }
    const at = Date.UTC(2026, 10, 15, 9, 0, 0)
    const turned = footprintAt(target, phoenix, at, 37, 6).outline
    const half = footprintAt(target, phoenix, at, 217, 6).outline

    turned.forEach(point => expect(Math.min(...half.map(other => separation(point, other)))).toBeLessThan(1e-6))
  })

  it('is square to north when no angle is known', () => {
    const target = { raDegrees: 130, decDegrees: 20 }
    const at = Date.UTC(2026, 10, 15, 9, 0, 0)

    expect(footprintAt(target, phoenix, at, undefined, 6).outline).toEqual(footprintAt(target, phoenix, at, 0, 6).outline)
  })
})

describe('the lowest edge of the footprint against the line', () => {
  const target = transitingAt(middle, 0)
  const outline = footprintAt(target, phoenix, middle - 20 * minuteMs, undefined, 64).outline
  const centre = footprintAt(target, phoenix, middle - 20 * minuteMs, undefined, 1).centre
  const bottomAt = (azimuth: number) => Math.min(...outline.filter(point => Math.abs(point.azimuthDegrees - azimuth) < 0.05).map(point => point.altitudeDegrees))
  const peakBin = Math.round(centre.azimuthDegrees)

  it('is the margin of the lowest point when the line is flat', () => {
    const lowest = Math.min(...outline.map(point => point.altitudeDegrees))

    expect(lowestClearance(outline, lineOf(horizonOf([], 10)))).toBeCloseTo(lowest - 10, 3)
  })

  it('is cut by a one-bin tree peak between the bottom corners, which the four corners and the centre clear', () => {
    const peak = bottomAt(peakBin) + 0.5
    const line = lineOf(horizonOf([{ from: peakBin, to: peakBin, altitudeDegrees: peak }], 0))
    const corners = [0, 16, 32, 48].map(index => outline[index]!)
    const [left, right] = [Math.min(...corners.map(corner => corner.azimuthDegrees)), Math.max(...corners.map(corner => corner.azimuthDegrees))]

    expect(peakBin).toBeGreaterThan(left)
    expect(peakBin).toBeLessThan(right)
    expect(corners.every(corner => corner.altitudeDegrees > lineAt(line, corner.azimuthDegrees).degrees)).toBe(true)
    expect(centre.altitudeDegrees).toBeGreaterThan(peak)
    expect(lowestClearance(outline, line)).toBeCloseTo(bottomAt(peakBin) - peak, 1)
    expect(lowestClearance(outline, line)).toBeLessThan(0)
  })

  it('sees a peak that sits between two whole degrees of azimuth only by its bin, never by a sample that misses it', () => {
    const line = lineOf(horizonOf([{ from: peakBin, to: peakBin, altitudeDegrees: bottomAt(peakBin) + 0.5 }], 0))
    const shifted = outline.map(point => ({ azimuthDegrees: point.azimuthDegrees + 0.5, altitudeDegrees: point.altitudeDegrees }))

    expect(lowestClearance(shifted, line)).toBeLessThan(0)
  })

  it('uses the up-line where a bin has no edge, and the edge where it has one', () => {
    const unmapped = lineOf(horizonOf([], null))

    expect(lowestClearance(outline, unmapped)).toBeCloseTo(Math.min(...outline.map(point => point.altitudeDegrees)) - 30, 3)
  })

  it('reads the line across north as one line, whichever side of 0 and 360 a bin is on', () => {
    const north = footprintAt(transitingAt(middle, 85), phoenix, middle, undefined, 64)
    const azimuths = north.outline.map(point => point.azimuthDegrees)

    expect(Math.min(...azimuths)).toBeLessThan(0)
    expect(Math.max(...azimuths)).toBeGreaterThan(0)

    const lowestAtZero = Math.min(...north.outline.filter(point => Math.abs(point.azimuthDegrees) < 0.1).map(point => point.altitudeDegrees))

    for (const bin of [358, 359, 0, 1]) {
      const line = lineOf(horizonOf([{ from: bin, to: bin, altitudeDegrees: lowestAtZero + 0.5 }], 0))

      expect(lowestClearance(north.outline, line)).toBeLessThan(0)
    }

    expect(lowestClearance(north.outline, lineOf(horizonOf([{ from: 20, to: 40, altitudeDegrees: 80 }], 0)))).toBeGreaterThan(0)
  })
})

describe('the first clean frame of a night', () => {
  const edgeBlock = [{ from: 0, to: 169, altitudeDegrees: 80 }]
  const peakBlock = (height: number) => [...edgeBlock, { from: 175, to: 175, altitudeDegrees: height }]

  const centreClearsAt = (line: HorizonLine) => {
    for (let at = night.darkAt!; at <= night.darkEndsAt!; at += minuteMs) {
      const { centre } = footprintAt(transitingAt(middle, 0), phoenix, at, undefined, 1)

      if (centre.altitudeDegrees > lineAt(line, centre.azimuthDegrees).degrees) return at
    }

    return undefined
  }

  const bruteForce = (line: HorizonLine, from: number, until: number, edgeSamples: number) => {
    for (let at = from; at <= until; at += 10_000) {
      const { outline } = footprintAt(transitingAt(middle, 0), phoenix, at, undefined, edgeSamples)

      if (outline.every(point => point.altitudeDegrees > lineAt(line, point.azimuthDegrees).degrees)) return at
    }

    return undefined
  }

  const fourCorners = (line: HorizonLine) => {
    for (let at = night.darkAt!; at <= night.darkEndsAt!; at += minuteMs) {
      const { outline } = footprintAt(transitingAt(middle, 0), phoenix, at, undefined, 1)

      if (outline.every(point => point.altitudeDegrees > lineAt(line, point.azimuthDegrees).degrees)) return at
    }

    return undefined
  }

  it('is the start of darkness when the frame is clear of everything then', () => {
    expect(frameNight(input()).firstCleanAt).toBe(night.darkAt)
  })

  it('is later than the centre clearing, by about the width of the frame', () => {
    const line = lineOf(horizonOf(edgeBlock))
    const { firstCleanAt } = frameNight(input({ line }))
    const exact = bruteForce(line, night.darkAt!, night.darkEndsAt!, 200)!

    expect(firstCleanAt).not.toBeNull()
    expect(Math.abs(firstCleanAt! - exact)).toBeLessThanOrEqual(10_000)
    expect(firstCleanAt! - centreClearsAt(line)!).toBeGreaterThan(5 * minuteMs)
  })

  it('waits past a narrow tree peak between the bottom corners that the four corners would pass', () => {
    const line = lineOf(horizonOf(peakBlock(56)))
    const { firstCleanAt } = frameNight(input({ line }))
    const exact = bruteForce(line, firstCleanAt! - 20 * minuteMs, firstCleanAt! + 5 * minuteMs, 1500)!
    const corners = fourCorners(line)!

    expect(Math.abs(firstCleanAt! - exact)).toBeLessThanOrEqual(10_000)
    expect(firstCleanAt! - corners).toBeGreaterThan(5 * minuteMs)
    expect(centreClearsAt(line)).toBeLessThan(corners)
  })

  it('is null when the frame never clears in the dark', () => {
    expect(frameNight(input({ line: lineOf(horizonOf([], 80)) })).firstCleanAt).toBeNull()
  })

  it('is null when there is no full dark', () => {
    expect(frameNight(input({ night: { ...night, darkAt: undefined, darkEndsAt: undefined } })).firstCleanAt).toBeNull()
  })

  it('serves north angles on the path steps, rounded to the decimals asked, and the camera angle it used', () => {
    const answer = frameNight(input({ cameraAngleDegrees: 12.34, angleDecimals: 1 }))
    const count = Math.floor((night.dawnAt - night.duskAt) / minuteMs) + 1

    expect(answer.angleDegrees).toBe(12.34)
    expect(answer.northAngles).toHaveLength(count)
    expect(answer.northAngles.every(angle => Math.abs(angle * 10 - Math.round(angle * 10)) < 1e-9)).toBe(true)
    expect(frameNight(input()).angleDegrees).toBeNull()
  })

  it('has the direction of north to the pole of the sky at the meridian: straight up in the south, straight down in the north', () => {
    const south = footprintAt(transitingAt(middle, 0), phoenix, middle, undefined, 1)
    const north = footprintAt(transitingAt(middle, 85), phoenix, middle, undefined, 1)

    expect(Math.abs(south.northAngleDegrees)).toBeLessThan(0.5)
    expect(Math.abs(Math.abs(north.northAngleDegrees) - 180)).toBeLessThan(2)
  })
})
