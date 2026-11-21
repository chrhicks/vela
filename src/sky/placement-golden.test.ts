import { SiderealTime } from 'astronomy-engine'
import { describe, expect, it } from 'vitest'
import { noHorizon, type Horizon } from '../horizon/horizon.ts'
import { fromMount } from './coordinates.ts'
import { nightTimes } from './darkness.ts'
import { placementOf, type UpLine } from './placement.ts'

const phoenix = { latitudeDegrees: 33.45, longitudeDegrees: -112.07, elevationMeters: 331 }
const at = Date.UTC(2026, 10, 15, 4, 0, 0)
const elsewhere = { raDegrees: 0, decDegrees: 0 }

const upLine = (horizon: Horizon, stepSeconds = 60): UpLine => ({ horizon, upLineDegrees: 30, stepSeconds, lookAheadHours: 12 })

const horizonOf = (altitudeDegrees: number, blocks: ReadonlyArray<{ readonly from: number; readonly to: number; readonly altitudeDegrees: number }> = []): Horizon => ({
  ...noHorizon,
  altitudesDegrees: noHorizon.altitudesDegrees.map((_, bin) => blocks.find(block => bin >= block.from && bin <= block.to)?.altitudeDegrees ?? altitudeDegrees),
})

const overheadAt = (when: number, hoursPastMeridian: number, decDegrees: number) => {
  const localSiderealHours = SiderealTime(new Date(when)) + phoenix.longitudeDegrees / 15

  return fromMount({ raDegrees: (((localSiderealHours - hoursPastMeridian) * 15) % 360 + 360) % 360, decDegrees }, new Date(when))
}

const eastBlock = horizonOf(10, [{ from: 60, to: 130, altitudeDegrees: 40 }])
const edgeOnly: Horizon = { ...noHorizon, altitudesDegrees: noHorizon.altitudesDegrees.map((_, bin) => (bin >= 200 ? 12 : bin < 90 ? 35 : null)) }
const gapEast: Horizon = { ...noHorizon, altitudesDegrees: noHorizon.altitudesDegrees.map((_, bin) => (bin >= 70 && bin <= 140 ? null : 10)) }
const afterDawnRequest = Date.UTC(2026, 10, 15, 12, 7, 41)

describe('placementOf, pinned', () => {
  it('rises behind a block, asked 37 s past a minute', () => {
    expect(placementOf(overheadAt(at, -6, 20), phoenix, at + 37_000, upLine(eastBlock), elsewhere)).toEqual({
      altitudeDegrees: 10.990138050978938,
      lineDegrees: 40,
      lineSource: 'horizon',
      moonDegrees: 91.68377838215116,
      line: { above: 'rises', at: 1794723674484, lineSource: 'horizon', lineDegrees: 40 },
    })
  })

  it('sets over a flat line, asked 29 s past a minute', () => {
    expect(placementOf(overheadAt(at, 1, 20), phoenix, at + 29_000, upLine(noHorizon), elsewhere)).toEqual({
      altitudeDegrees: 70.98382616035515,
      lineDegrees: 30,
      lineSource: 'up-line',
      moonDegrees: 23.661151810411077,
      line: { above: 'until', until: 1794727548432, lineSource: 'up-line', lineDegrees: 30 },
    })
  })

  it('rises after dawn within the look-ahead, over a flat line and over a mapped one', () => {
    const target = overheadAt(at, 0.5, 20)
    const dawnAt = nightTimes(phoenix, afterDawnRequest)!.dawnAt

    const flat = placementOf(target, phoenix, afterDawnRequest, upLine(noHorizon), elsewhere)
    const mapped = placementOf(target, phoenix, afterDawnRequest, upLine(horizonOf(10)), elsewhere)

    expect(dawnAt).toBeGreaterThan(afterDawnRequest)
    expect(flat).toEqual({
      altitudeDegrees: -18.232595771245904,
      lineDegrees: 30,
      lineSource: 'up-line',
      moonDegrees: 20.606846742860082,
      line: { above: 'rises', at: 1794783630405, lineSource: 'up-line', lineDegrees: 30 },
    })
    expect(mapped).toEqual({
      altitudeDegrees: -18.232595771245904,
      lineDegrees: 10,
      lineSource: 'horizon',
      moonDegrees: 20.606846742860082,
      line: { above: 'rises', at: 1794777767769, lineSource: 'horizon', lineDegrees: 10 },
    })
    expect(flat.line.above === 'rises' ? flat.line.at : 0).toBeGreaterThan(dawnAt)
    expect(mapped.line.above === 'rises' ? mapped.line.at : 0).toBeGreaterThan(dawnAt)
  })

  it('is always above, and never above', () => {
    expect(placementOf(overheadAt(at, 5, 89), phoenix, at, upLine(noHorizon), elsewhere)).toEqual({
      altitudeDegrees: 33.703412002196394,
      lineDegrees: 30,
      lineSource: 'up-line',
      moonDegrees: 89.55969060448288,
      line: { above: 'always' },
    })
    expect(placementOf(overheadAt(at, 0, 80), phoenix, at, upLine(horizonOf(20)), elsewhere)).toEqual({
      altitudeDegrees: 43.45000000000001,
      lineDegrees: 20,
      lineSource: 'horizon',
      moonDegrees: 79.85471754721551,
      line: { above: 'always' },
    })
    expect(placementOf(overheadAt(at, 0, -60), phoenix, at, upLine(noHorizon), elsewhere)).toEqual({
      altitudeDegrees: -3.449999999999998,
      lineDegrees: 30,
      lineSource: 'up-line',
      moonDegrees: 60.167685131720205,
      line: { above: 'no' },
    })
    expect(placementOf(overheadAt(at, 0, -60), phoenix, at, upLine(horizonOf(10)), elsewhere)).toEqual({
      altitudeDegrees: -3.449999999999998,
      lineDegrees: 10,
      lineSource: 'horizon',
      moonDegrees: 60.167685131720205,
      line: { above: 'no' },
    })
  })

  it('uses the horizon where a bin is known and the up line where it is not', () => {
    expect(placementOf(overheadAt(at, -6, 20), phoenix, at + 11_000, upLine(edgeOnly), elsewhere)).toEqual({
      altitudeDegrees: 10.903388547044441,
      lineDegrees: 35,
      lineSource: 'horizon',
      moonDegrees: 91.68377838215116,
      line: { above: 'rises', at: 1794722239934, lineSource: 'horizon', lineDegrees: 35 },
    })
    expect(placementOf(overheadAt(at, 2, 30), phoenix, at + 11_000, upLine(edgeOnly), elsewhere)).toEqual({
      altitudeDegrees: 64.30170180383071,
      lineDegrees: 12,
      lineSource: 'horizon',
      moonDegrees: 40.10408604403172,
      line: { above: 'until', until: 1794730847275, lineSource: 'horizon', lineDegrees: 12 },
    })
    expect(placementOf(overheadAt(at, -8, 10), phoenix, at + 17_000, upLine(gapEast), elsewhere)).toEqual({
      altitudeDegrees: -18.3153443156195,
      lineDegrees: 10,
      lineSource: 'horizon',
      moonDegrees: 121.27686911030031,
      line: { above: 'rises', at: 1794729434557, lineSource: 'up-line', lineDegrees: 30 },
    })
    expect(placementOf(overheadAt(at, -4, 10), phoenix, at + 17_000, upLine(gapEast), elsewhere)).toEqual({
      altitudeDegrees: 30.493719217580534,
      lineDegrees: 30,
      lineSource: 'up-line',
      moonDegrees: 62.28209181829404,
      line: { above: 'until', until: 1794749799123, lineSource: 'horizon', lineDegrees: 10 },
    })
  })

  it('steps by the step it is given', () => {
    expect(placementOf(overheadAt(at, -6, 20), phoenix, at + 13_000, upLine(eastBlock, 300), elsewhere)).toEqual({
      altitudeDegrees: 10.910060693650943,
      lineDegrees: 40,
      lineSource: 'horizon',
      moonDegrees: 91.68377838215116,
      line: { above: 'rises', at: 1794723674491, lineSource: 'horizon', lineDegrees: 40 },
    })
  })
})
