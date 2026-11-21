import { describe, expect, it } from 'vitest'
import { noHorizon, type Horizon } from '../horizon/horizon.ts'
import type { Site } from '../pointing/target.ts'
import { fromMount } from '../sky/coordinates.ts'
import { equatorialOfDate } from '../sky/horizontal.ts'
import { horizonSentence, lineOf, type FrameView } from './line.ts'

const phoenix: Site = { latitudeDegrees: 33.45, longitudeDegrees: -112.07, elevationMeters: 331 }

const at = Date.UTC(2026, 10, 18, 5, 0, 0)

const lineAt = (azimuth: number) => 20 + 10 * Math.sin((azimuth * Math.PI) / 180)

const hilly: Horizon = {
  ...noHorizon,
  altitudesDegrees: Array.from({ length: 360 }, (_, azimuth) => lineAt(azimuth)),
}

const columns = 6248
const rows = 4176
const scale = 1.939 / 3600
const heightDegrees = 2.25

const skyAt = (altitude: number, azimuth: number) => {
  const ofDate = equatorialOfDate(altitude, azimuth, at, phoenix)

  return fromMount({ raDegrees: ofDate.raHours * 15, decDegrees: ofDate.decDegrees }, new Date(at))
}

const rotated = (degrees: number) => {
  const angle = (degrees * Math.PI) / 180

  return [
    [-scale * Math.cos(angle), -scale * Math.sin(angle)],
    [scale * Math.sin(angle), -scale * Math.cos(angle)],
  ] as const
}

const viewOf = (altitude: number, azimuth: number, solution: 'none' | 'at the same place' | 'elsewhere' = 'none', turn = 0): FrameView => {
  const here = skyAt(altitude, azimuth)
  const solved = solution === 'elsewhere' ? skyAt(altitude - 8, azimuth) : here

  return {
    at,
    site: phoenix,
    columns,
    rows,
    heightDegrees,
    mount: solution === 'elsewhere' ? skyAt(altitude + 8, azimuth) : here,
    solution: solution === 'none' ? null : { centre: solved, referencePixel: [(columns + 1) / 2, (rows + 1) / 2], matrix: rotated(turn) },
  }
}

describe('where a frame sits against the mapped line', () => {
  it('gives how far the centre is above the line at its own azimuth, whichever way the line runs', () => {
    for (const azimuth of [100, 250]) {
      const line = lineOf(viewOf(lineAt(azimuth) + 7, azimuth, 'at the same place'), hilly)

      expect(line).toMatchObject({ centreDegrees: 7, source: 'solve', heightDegrees: 2.3 })
      expect(line?.lowestDegrees).toBeGreaterThan(4)
    }
  })

  it('gives a negative distance for a frame below the line, lowest point lower still', () => {
    const line = lineOf(viewOf(lineAt(100) - 6, 100, 'at the same place'), hilly)

    expect(line?.centreDegrees).toBe(-6)
    expect(line?.lowestDegrees).toBeLessThan(-6)
  })

  it('finds a frame that straddles the line, whatever its rotation: centre above, some part below', () => {
    for (const turn of [0, 35, 90, 140]) {
      const line = lineOf(viewOf(lineAt(100) + 0.4, 100, 'at the same place', turn), hilly)

      expect(line?.centreDegrees).toBe(0.4)
      expect(line?.lowestDegrees).toBeLessThan(0)
    }
  })

  it('takes the frame\'s own solve over the mount\'s position when it has one', () => {
    expect(lineOf(viewOf(lineAt(100) + 3, 100, 'elsewhere'), hilly)).toMatchObject({ centreDegrees: -5, source: 'solve' })
  })

  it('falls back to the mount\'s reported position with room for any rotation', () => {
    const line = lineOf(viewOf(lineAt(100) + 3, 100), hilly)

    expect(line).toMatchObject({ centreDegrees: 3, source: 'mount', heightDegrees: 2.3 })
    expect(line?.lowestDegrees).toBeCloseTo(1, 0)
  })

  it('says nothing where the line is unknown at the centre: no horizon file, or an unmapped bin', () => {
    const gap: Horizon = { ...hilly, altitudesDegrees: hilly.altitudesDegrees.map((altitude, bin) => (bin === 100 ? null : altitude)) }

    expect(lineOf(viewOf(30, 100, 'at the same place'), noHorizon)).toBeUndefined()
    expect(lineOf(viewOf(30, 100), noHorizon)).toBeUndefined()
    expect(lineOf(viewOf(lineAt(100.5) + 3, 100.5, 'at the same place'), gap)).toBeUndefined()
    expect(lineOf(viewOf(lineAt(100.5) + 3, 100.5), gap)).toBeUndefined()
    expect(lineOf(viewOf(lineAt(200) + 3, 200), gap)).toBeDefined()
  })

  it('ignores the unmapped part of the outline when the centre is mapped', () => {
    const edge: Horizon = { ...hilly, altitudesDegrees: hilly.altitudesDegrees.map((altitude, bin) => (bin >= 98 && bin <= 101 ? null : altitude)) }

    expect(lineOf(viewOf(lineAt(60) + 3, 60, 'at the same place'), edge)).toMatchObject({ centreDegrees: 3 })
  })
})

describe('the sentence', () => {
  it('says above, below and level, in degrees and tenths', () => {
    expect(horizonSentence({ centreDegrees: 3, heightDegrees: 2.2 })).toBe('The frame\'s centre is 3 degrees above the mapped tree line in its direction, and the frame is about 2.2 degrees tall.')
    expect(horizonSentence({ centreDegrees: -1.4, heightDegrees: 2.2 })).toBe('The frame\'s centre is 1.4 degrees below the mapped tree line in its direction, and the frame is about 2.2 degrees tall.')
    expect(horizonSentence({ centreDegrees: 1, heightDegrees: 1 })).toBe('The frame\'s centre is 1 degree above the mapped tree line in its direction, and the frame is about 1 degree tall.')
    expect(horizonSentence({ centreDegrees: 0, heightDegrees: 2.2 })).toContain('is level with the mapped tree line')
  })
})
