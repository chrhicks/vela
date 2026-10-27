import type { HorizonBinKind, HorizonStatus, TargetSkyPath } from '@vela/model/web'
import { describe, expect, it } from 'vitest'
import { horizonNote, horizonRuns, horizonWindowNote } from './horizon'

const start = Date.UTC(2026, 0, 1, 0, 0)

/** One sample per 15 minutes: [horizon, altitude, sun altitude]. */
function sky(rows: Array<[HorizonStatus | null, number?, number?, HorizonBinKind?]>): TargetSkyPath {
  return {
    observedAt: new Date(start).toISOString(),
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + (rows.length - 1) * 900_000).toISOString(),
    samples: rows.map(([horizon, altitude = 40, sun = -30, horizonBin = horizon === 'unknown' ? 'unknown' : 'traced'], index) => ({
      at: new Date(start + index * 900_000).toISOString(),
      azimuthDegrees: 10,
      altitudeDegrees: altitude,
      horizon,
      horizonBin,
      sunAltitudeDegrees: sun,
      moon: { azimuthDegrees: 0, altitudeDegrees: 0, illuminationFraction: 0, waxing: true },
    })),
    currentMoonSeparationDegrees: 90,
    currentAzimuthDegrees: 10,
    currentAltitudeDegrees: 40,
    highestAltitudeDegrees: 40,
    aboveHorizonDuringDarkness: [],
  }
}

describe('horizon runs', () => {
  it('groups consecutive planned samples of one status and ignores daylight and below-horizon samples', () => {
    const night = sky([
      ['behind', 40, -5],
      ['behind'],
      ['behind'],
      ['clear'],
      ['behind'],
      ['behind', -3],
      ['unknown'],
      [null],
    ])

    expect(horizonRuns(night, 'behind')).toEqual([
      { from: 1, to: 2 },
      { from: 4, to: 4 },
    ])
    expect(horizonRuns(night, 'unknown')).toEqual([{ from: 6, to: 6 }])
    expect(horizonRuns(night, 'clear')).toEqual([{ from: 3, to: 3 }])
  })
})

describe('horizon notes', () => {
  it('says nothing without a profile or for a clear night', () => {
    expect(horizonNote(sky([[null], [null]]))).toEqual([])
    expect(horizonNote(sky([['clear'], ['clear']]))).toEqual([])
    expect(horizonWindowNote(null)).toEqual([])
    expect(horizonWindowNote({ checkedMinutes: 60, behindMinutes: 0, unknownMinutes: 0 })).toEqual([])
  })

  it('warns about trees and about untraced stretches separately, never calling untraced stretches clear or blocked', () => {
    const lines = horizonNote(sky([['clear'], ['behind'], ['behind'], ['unknown'], ['clear']]))

    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^May be behind trees \S+–\S+\.$/)
    expect(lines[1]).toMatch(/^Horizon untraced \S+–\S+\.$/)
    expect(lines.join(' ')).not.toMatch(/clear|blocked/i)
  })

  it('names the window minutes for the target list', () => {
    expect(horizonWindowNote({ checkedMinutes: 240, behindMinutes: 90, unknownMinutes: 30 })).toEqual([
      'May be behind trees for 1 h 30 min',
      'Horizon untraced for 30 min',
    ])

    expect(horizonWindowNote({ checkedMinutes: 240, behindMinutes: 120, unknownMinutes: 0 })).toEqual([
      'May be behind trees for 2 h',
    ])
  })
})
