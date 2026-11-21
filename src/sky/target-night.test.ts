import { SiderealTime } from 'astronomy-engine'
import { describe, expect, it } from 'vitest'
import { altitudeAt, noHorizon, type Horizon } from '../horizon/horizon.ts'
import { fromMount } from './coordinates.ts'
import { nightTimes, type NightTimes } from './darkness.ts'
import { horizontalOfJ2000 } from './horizontal.ts'
import { compassOf, targetNight, type TargetNightInput } from './target-night.ts'

const phoenix = { latitudeDegrees: 33.45, longitudeDegrees: -112.07, elevationMeters: 331 }
const radians = Math.PI / 180
const degrees = 180 / Math.PI
const siderealPerSolar = 1.0027379093
const afternoon = Date.UTC(2026, 10, 15, 22, 0, 0)
const night = nightTimes(phoenix, afternoon)!
const darkAt = night.darkAt!
const darkEndsAt = night.darkEndsAt!
const middle = Math.round((darkAt + darkEndsAt) / 2)

const overheadAt = (when: number, hoursPastMeridian: number, decDegrees: number) => {
  const localSiderealHours = SiderealTime(new Date(when)) + phoenix.longitudeDegrees / 15

  return fromMount({ raDegrees: (((localSiderealHours - hoursPastMeridian) * 15) % 360 + 360) % 360, decDegrees }, new Date(when))
}

const equatorTransitingAtMiddle = overheadAt(middle, 0, 0)

const horizonOf = (altitudeDegrees: number | null, blocks: ReadonlyArray<{ readonly from: number; readonly to: number; readonly altitudeDegrees: number }> = []): Horizon => ({
  ...noHorizon,
  altitudesDegrees: noHorizon.altitudesDegrees.map((_, bin) => blocks.find(block => bin >= block.from && bin <= block.to)?.altitudeDegrees ?? altitudeDegrees),
})

const input = (overrides: Partial<TargetNightInput> = {}): TargetNightInput => ({
  target: equatorTransitingAtMiddle,
  site: phoenix,
  night,
  at: night.duskAt,
  line: { horizon: noHorizon, upLineDegrees: 30 },
  stepSeconds: 60,
  decimals: 2,
  meridianLimitDegrees: undefined,
  ...overrides,
})

const hourAngleAbove = (lineDegrees: number) => Math.acos(Math.sin(lineDegrees * radians) / Math.cos(phoenix.latitudeDegrees * radians)) * degrees

const azimuthAtHourAngle = (hourAngleDegrees: number) => {
  const hourAngle = hourAngleDegrees * radians

  return (Math.atan2(-Math.sin(hourAngle), -Math.cos(hourAngle) * Math.sin(phoenix.latitudeDegrees * radians)) * degrees + 360) % 360
}

const secondsPerHourAngleDegree = 240 / siderealPerSolar

describe("a target's night", () => {
  it('samples from dusk to dawn in rounded parallel arrays', () => {
    const { path } = targetNight(input())
    const count = Math.floor((night.dawnAt - night.duskAt) / 60_000) + 1

    expect(path.startAt).toBe(night.duskAt)
    expect(path.stepSeconds).toBe(60)
    expect(path.altitudes).toHaveLength(count)
    expect(path.azimuths).toHaveLength(count)
    expect(path.lines).toHaveLength(count)
    expect(path.lines.every(line => line === 30)).toBe(true)
    expect(path.azimuths.every(azimuth => azimuth >= 0 && azimuth < 360)).toBe(true)
    expect(path.altitudes.every(altitude => altitude === Math.round(altitude * 100) / 100)).toBe(true)
  })

  it('puts the line altitude at each azimuth in lines, the horizon where mapped and the up line where not', () => {
    const { path } = targetNight(input({ line: { horizon: horizonOf(null, [{ from: 150, to: 210, altitudeDegrees: 70 }]), upLineDegrees: 30 } }))
    const southern = path.azimuths.flatMap((azimuth, index) => (azimuth > 151 && azimuth < 209 ? [path.lines[index]!] : []))
    const eastern = path.azimuths.flatMap((azimuth, index) => (azimuth > 20 && azimuth < 140 ? [path.lines[index]!] : []))

    expect(southern.length).toBeGreaterThan(0)
    expect(southern.every(line => line === 70)).toBe(true)
    expect(eastern.length).toBeGreaterThan(0)
    expect(eastern.every(line => line === 30)).toBe(true)
  })

  it('finds the one clear spell of a target crossing a flat 30 degree line, to the second', () => {
    const { clear, facts } = targetNight(input())
    const half = hourAngleAbove(30) * secondsPerHourAngleDegree * 1000

    expect(clear).toHaveLength(1)
    expect(Math.abs(clear[0]!.from - (middle - half))).toBeLessThan(2000)
    expect(Math.abs(clear[0]!.until - (middle + half))).toBeLessThan(2000)
    expect(clear[0]!.startedBy).toMatchObject({ cause: 'up-line' })
    expect(clear[0]!.endedBy).toMatchObject({ cause: 'up-line' })

    const rises = clear[0]!.startedBy
    const sets = clear[0]!.endedBy

    expect(rises.cause === 'up-line' ? Math.abs(rises.azimuthDegrees - azimuthAtHourAngle(-hourAngleAbove(30))) : NaN).toBeLessThan(0.1)
    expect(sets.cause === 'up-line' ? Math.abs(sets.azimuthDegrees - azimuthAtHourAngle(hourAngleAbove(30))) : NaN).toBeLessThan(0.1)
    expect(facts.clear).toMatchObject({ which: 'next', clearsAt: clear[0]!.from, endsAt: clear[0]!.until })
    expect(Math.abs(facts.clear!.clearForSeconds - 2 * hourAngleAbove(30) * secondsPerHourAngleDegree)).toBeLessThan(2)
  })

  it('is on the line at each end of a clear spell', () => {
    const { clear } = targetNight(input())

    for (const time of [clear[0]!.from, clear[0]!.until]) {
      expect(Math.abs(horizontalOfJ2000(equatorTransitingAtMiddle, time, phoenix).altitudeDegrees - 30)).toBeLessThan(0.02)
    }
  })

  it('is clear for the whole dark when the target stays over the line, and says dark began and ended it', () => {
    const { clear, facts } = targetNight(input({ line: { horizon: horizonOf(5), upLineDegrees: 30 } }))

    expect(clear).toEqual([{ from: darkAt, until: darkEndsAt, startedBy: { cause: 'dark' }, endedBy: { cause: 'dark' } }])
    expect(facts.clear).toEqual({ which: 'next', clearsAt: darkAt, startedBy: { cause: 'dark' }, clearForSeconds: Math.round((darkEndsAt - darkAt) / 1000), endsAt: darkEndsAt, endedBy: { cause: 'dark' } })
  })

  it('says now, not next, when the moment asked is inside the clear spell', () => {
    const { facts } = targetNight(input({ at: middle, line: { horizon: horizonOf(5), upLineDegrees: 30 } }))

    expect(facts.clear?.which).toBe('now')
  })

  it('never clears behind a line above the highest the target gets, and says nothing is clear', () => {
    const { clear, facts } = targetNight(input({ line: { horizon: horizonOf(60), upLineDegrees: 30 } }))

    expect(clear).toEqual([])
    expect(facts.clear).toBeNull()
  })

  it('has two clear spells when a block stands across the south, each ended or started by trees with its direction', () => {
    const horizon = horizonOf(5, [{ from: 150, to: 210, altitudeDegrees: 70 }])
    const { clear, facts } = targetNight(input({ line: { horizon, upLineDegrees: 30 }, at: middle }))

    expect(clear).toHaveLength(2)
    expect(clear[0]).toMatchObject({ from: darkAt, startedBy: { cause: 'dark' } })
    expect(clear[1]).toMatchObject({ until: darkEndsAt, endedBy: { cause: 'dark' } })

    const [goes, returns] = [clear[0]!.endedBy, clear[1]!.startedBy]

    expect(goes).toMatchObject({ cause: 'trees', compass: 'SE' })
    expect(returns).toMatchObject({ cause: 'trees', compass: 'SW' })
    expect(goes.cause === 'trees' ? goes.azimuthDegrees : NaN).toBeGreaterThan(149)
    expect(goes.cause === 'trees' ? goes.azimuthDegrees : NaN).toBeLessThan(150)
    expect(returns.cause === 'trees' ? returns.azimuthDegrees : NaN).toBeGreaterThan(210)
    expect(returns.cause === 'trees' ? returns.azimuthDegrees : NaN).toBeLessThan(211)
    expect(clear[0]!.until).toBeLessThan(middle)
    expect(clear[1]!.from).toBeGreaterThan(middle)

    for (const time of [clear[0]!.until, clear[1]!.from]) {
      const there = horizontalOfJ2000(equatorTransitingAtMiddle, time, phoenix)

      expect(Math.abs(there.altitudeDegrees - altitudeAt(horizon, there.azimuthDegrees)!)).toBeLessThan(0.05)
    }

    expect(facts.clear).toMatchObject({ which: 'next', clearsAt: clear[1]!.from, startedBy: { cause: 'trees', compass: 'SW' } })
  })

  it('takes the spell that holds the moment asked, else the next, else none', () => {
    const horizon = horizonOf(5, [{ from: 150, to: 210, altitudeDegrees: 70 }])
    const line = { horizon, upLineDegrees: 30 }
    const { clear } = targetNight(input({ line }))
    const gap = Math.round((clear[0]!.until + clear[1]!.from) / 2)

    expect(targetNight(input({ line, at: clear[0]!.from + 1000 })).facts.clear).toMatchObject({ which: 'now', clearsAt: clear[0]!.from })
    expect(targetNight(input({ line, at: gap })).facts.clear).toMatchObject({ which: 'next', clearsAt: clear[1]!.from })
    expect(targetNight(input({ line, at: clear[1]!.until + 1000 })).facts.clear).toBeNull()
  })

  it('tells the up line from the trees where part of the horizon is unmapped', () => {
    const horizon: Horizon = { ...noHorizon, altitudesDegrees: noHorizon.altitudesDegrees.map((_, bin) => (bin >= 120 ? 30 : null)) }
    const { clear } = targetNight(input({ line: { horizon, upLineDegrees: 30 } }))

    expect(clear).toHaveLength(1)
    expect(clear[0]!.startedBy).toMatchObject({ cause: 'up-line' })
    expect(clear[0]!.endedBy).toMatchObject({ cause: 'trees', compass: compassOf(azimuthAtHourAngle(hourAngleAbove(30))) })
  })

  it('calls a crossing of a line at 0 degrees the horizon', () => {
    const { clear } = targetNight(input({ target: overheadAt(middle, 0, -40), line: { horizon: horizonOf(0), upLineDegrees: 30 } }))

    expect(clear).toHaveLength(1)
    expect(clear[0]!.startedBy).toMatchObject({ cause: 'horizon' })
    expect(clear[0]!.endedBy).toMatchObject({ cause: 'horizon' })
  })

  it('has no clear spells and still a path when the night has no full darkness', () => {
    const noDark: NightTimes = { duskAt: night.duskAt, darkAt: undefined, darkEndsAt: undefined, dawnAt: night.dawnAt }
    const { path, clear, facts } = targetNight(input({ night: noDark }))

    expect(path.altitudes.length).toBeGreaterThan(600)
    expect(clear).toEqual([])
    expect(facts.clear).toBeNull()
    expect(facts.highest.altitudeDegrees).toBeGreaterThan(50)
  })

  it('takes the highest altitude and the transit from the samples', () => {
    const { facts } = targetNight(input())

    expect(Math.abs(facts.highest.altitudeDegrees - (90 - phoenix.latitudeDegrees))).toBeLessThan(0.01)
    expect(Math.abs(facts.highest.at - middle)).toBeLessThanOrEqual(30_000)
    expect(Math.abs(facts.transitAt! - middle)).toBeLessThan(2000)
  })

  it('has no transit when the target is still climbing at dawn or has already passed it, and highest is the end of the night', () => {
    const rising = targetNight(input({ target: overheadAt(night.dawnAt, -2, 0) }))
    const setting = targetNight(input({ target: overheadAt(night.duskAt, 2, 0) }))

    expect(rising.facts.transitAt).toBeNull()
    expect(Math.abs(rising.facts.highest.at - night.dawnAt)).toBeLessThanOrEqual(60_000)
    expect(setting.facts.transitAt).toBeNull()
    expect(setting.facts.highest.at).toBe(night.duskAt)
  })

  it('predicts the flip at the meridian when the mount gives no limit, and says so', () => {
    const { facts } = targetNight(input())

    expect(facts.flip).toMatchObject({ basis: 'meridian', limitDegrees: null })
    expect(Math.abs(facts.flip!.at - middle)).toBeLessThan(2000)
  })

  it('predicts the flip at the mount limit past the meridian, and says which limit', () => {
    const { facts } = targetNight(input({ meridianLimitDegrees: 15 }))

    expect(facts.flip).toMatchObject({ basis: 'mount-limit', limitDegrees: 15 })
    expect(Math.abs(facts.flip!.at - (middle + (15 * 240 * 1000) / siderealPerSolar))).toBeLessThan(2000)
  })

  it('finds a flip whose transit was before dusk, and none when the limit is not reached by dawn', () => {
    const passedBeforeDusk = overheadAt(night.duskAt - 1800_000, 0, 0)

    expect(Math.abs(targetNight(input({ target: passedBeforeDusk, meridianLimitDegrees: 15 })).facts.flip!.at - (night.duskAt - 1800_000 + (15 * 240 * 1000) / siderealPerSolar))).toBeLessThan(2000)
    expect(targetNight(input({ target: passedBeforeDusk })).facts.flip).toBeNull()
  })

  it('is always above for a target near the pole, with one spell the length of the dark', () => {
    const { clear } = targetNight(input({ target: { raDegrees: 0, decDegrees: 89 } }))

    expect(clear).toEqual([{ from: darkAt, until: darkEndsAt, startedBy: { cause: 'dark' }, endedBy: { cause: 'dark' } }])
  })
})

describe('the compass direction of an azimuth', () => {
  it('is the nearest of eight points', () => {
    expect(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].map((_, point) => compassOf(point * 45))).toEqual(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'])
    expect(compassOf(22.4)).toBe('N')
    expect(compassOf(22.6)).toBe('NE')
    expect(compassOf(359)).toBe('N')
    expect(compassOf(-10)).toBe('N')
  })
})
