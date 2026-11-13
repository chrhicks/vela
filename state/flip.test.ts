import { SiderealTime } from 'astronomy-engine'
import { describe, expect, it } from 'vitest'
import { flip, greenwichSiderealHours } from './flip.ts'
import type { Mount } from './devices.ts'
import { entry, foldRig } from './testing.ts'

const phoenixLongitude = 360 - 112.07

const at = Date.UTC(2026, 10, 8, 5, 0, 0)

const mountReported = (property: string, elements: Readonly<Record<string, number | boolean>>) => entry('wire', at, { dir: 'in', device: 'mount', type: 'set', property, state: 'Ok', elements })

const rig = (raHours: number, extra: ReadonlyArray<ReturnType<typeof entry>> = []): Mount =>
  foldRig([
    mountReported('TELESCOPE_TRACK_STATE', { TRACK_ON: true, TRACK_OFF: false }),
    mountReported('EQUATORIAL_EOD_COORD', { RA: raHours, DEC: 60 }),
    mountReported('GEOGRAPHIC_COORD', { LAT: 33.45, LONG: phoenixLongitude, ELEV: 331 }),
    mountReported('MERIDIAN_LIMIT', { LIMIT: 1 }),
    mountReported('TELESCOPE_PIER_SIDE', { PIER_WEST: true, PIER_EAST: false }),
    ...extra,
  ]).devices.mount

const localSiderealHours = (greenwichSiderealHours(at) + phoenixLongitude / 15) % 24

describe('greenwichSiderealHours', () => {
  it('agrees with astronomy-engine within two seconds of time over decades', () => {
    for (const date of [Date.UTC(2000, 0, 1, 12), Date.UTC(2026, 10, 8, 5), Date.UTC(2040, 5, 30, 23, 59)]) {
      expect(Math.abs(greenwichSiderealHours(date) - SiderealTime(new Date(date)))).toBeLessThan(2 / 3600)
    }
  })
})

describe('flip', () => {
  it('counts down to the limit for a target that has not reached it', () => {
    const result = flip(rig((localSiderealHours + 2) % 24), at)

    expect(result._tag).toBe('In')
    expect(result._tag === 'In' && result.seconds / 3600).toBeCloseTo((2 + 1 / 15) / 1.0027379093, 3)
  })

  it('says how long ago the limit passed', () => {
    const result = flip(rig((localSiderealHours - 1.5 + 24) % 24), at)

    expect(result._tag).toBe('Past')
  })

  it('has none while not tracking or on the east side of the pier, and is unknown before the mount or the clock is known', () => {
    expect(flip(rig(1, [mountReported('TELESCOPE_TRACK_STATE', { TRACK_ON: false, TRACK_OFF: true })]), at)).toEqual({ _tag: 'NotTracking' })
    expect(flip(rig(1, [mountReported('TELESCOPE_PIER_SIDE', { PIER_WEST: false, PIER_EAST: true })]), at)).toEqual({ _tag: 'NoneThisSide' })
    expect(flip({}, at)).toEqual({ _tag: 'Unknown' })
    expect(flip(rig(1), undefined)).toEqual({ _tag: 'Unknown' })
  })
})
