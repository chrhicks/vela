import { describe, expect, it } from 'vitest'
import type { HorizonNight } from './horizon-night.ts'
import { sliderSettings } from './horizon-slider.ts'
import {
  backTo,
  clampedTo,
  clearAt,
  clockIn,
  fractionOf,
  hourTicks,
  lastNightsWords,
  laneRuns,
  lineNote,
  lineRuns,
  meridianAzimuths,
  moonMarkAt,
  moonPercent,
  moonPieces,
  moonPointAt,
  nightFacts,
  nightSpan,
  nowPoint,
  pathPieces,
  readoutAt,
  readoutSentence,
  separationDegrees,
  skyPointAt,
  spanWords,
  startingTime,
  steppedBy,
  timeAtFraction,
  trackHours,
  zoneName,
} from './horizon-view.ts'

const zone = 'America/Phoenix'
const minuteMs = 60_000
const start = Date.UTC(2026, 10, 15, 0, 30, 0)

const path = (altitudes: ReadonlyArray<number>, azimuths: ReadonlyArray<number>) => ({ startAt: start, stepSeconds: 60, altitudes, azimuths, lines: altitudes.map(() => 30) })

const bins = (altitudes: ReadonlyArray<number | null>): HorizonNight['horizon'] => ({
  fileLoaded: true,
  altitudesDegrees: altitudes,
  sources: altitudes.map(() => null),
  sweepNights: [],
  upLineDegrees: 30,
})

const flat = (altitude: number | null) => bins(Array.from({ length: 360 }, () => altitude))

const night = (facts: HorizonNight['facts']): HorizonNight => ({
  target: { id: 'orion' as HorizonNight['target']['id'], name: 'M 42', commonName: null },
  at: start,
  night: '2026-11-14' as HorizonNight['night'],
  zone,
  times: { duskAt: start, darkAt: start, darkEndsAt: start, dawnAt: start },
  horizon: flat(10),
  path: path([10, 20, 30], [100, 110, 120]),
  moon: { litFraction: 0.9, altitudes: [-5, 5, 15], azimuths: [250, 255, 260], upSpans: [{ from: start + minuteMs, until: start + 2 * minuteMs }] },
  clear: [],
  facts,
})

describe('the target path as pieces', () => {
  it('is solid inside a clear spell and dashed outside, the pieces sharing the sample where they meet', () => {
    const clear = [{ from: start + minuteMs, until: start + 2 * minuteMs, startedBy: { cause: 'dark' as const }, endedBy: { cause: 'dark' as const } }]
    const pieces = pathPieces(path([10, 20, 30, 40], [100, 110, 120, 130]), clear)

    expect(pieces.map(piece => piece.clear)).toEqual([false, true, false])
    expect(pieces[0]?.points.map(point => point.altitudeDegrees)).toEqual([10])
    expect(pieces[1]?.points.map(point => point.altitudeDegrees)).toEqual([10, 20, 30])
    expect(pieces[2]?.points.map(point => point.altitudeDegrees)).toEqual([30, 40])
  })

  it('splits where the azimuth wraps through north', () => {
    const pieces = pathPieces(path([10, 20, 30, 40], [350, 358, 3, 10]), [])

    expect(pieces.map(piece => piece.points.map(point => point.azimuthDegrees))).toEqual([[350, 358], [3, 10]])
  })

  it('leaves out the samples below the horizon and starts a new piece when the target rises', () => {
    const pieces = pathPieces(path([5, -1, -2, 4, 8], [10, 12, 14, 16, 18]), [])

    expect(pieces.map(piece => piece.points.map(point => point.altitudeDegrees))).toEqual([[5], [4, 8]])
  })

  it('draws nothing for a path that never rises', () => {
    expect(pathPieces(path([-5, -3, -1], [10, 12, 14]), [])).toEqual([])
  })
})

describe('a point on the path', () => {
  const along = path([10, 20, 30], [100, 110, 120])

  it('is the sample on a step and the straight line between two', () => {
    expect(skyPointAt(along, start + minuteMs)).toEqual({ azimuthDegrees: 110, altitudeDegrees: 20 })
    expect(skyPointAt(along, start + minuteMs * 1.5)).toEqual({ azimuthDegrees: 115, altitudeDegrees: 25 })
  })

  it('is nothing outside the night', () => {
    expect(skyPointAt(along, start - 1)).toBeUndefined()
    expect(skyPointAt(along, start + 2 * minuteMs + 1)).toBeUndefined()
    expect(nowPoint(along, undefined)).toBeUndefined()
    expect(nowPoint(along, start - 1)).toBeUndefined()
  })

  it('takes the nearer sample across the wrap rather than a point through the south', () => {
    expect(skyPointAt(path([10, 20], [358, 2]), start + 20_000)).toEqual({ azimuthDegrees: 358, altitudeDegrees: 10 })
    expect(skyPointAt(path([10, 20], [358, 2]), start + 40_000)).toEqual({ azimuthDegrees: 2, altitudeDegrees: 20 })
  })

  it('has no NOW dot while the target is below the horizon', () => {
    expect(nowPoint(path([-2, -1], [10, 12]), start)).toBeUndefined()
    expect(nowPoint(along, start)).toEqual({ azimuthDegrees: 100, altitudeDegrees: 10 })
  })
})

describe('hour ticks', () => {
  it('fall on whole hours of the answer zone, not the browser and not UTC', () => {
    const hours = path(
      Array.from({ length: 200 }, (_, index) => 10 + index / 10),
      Array.from({ length: 200 }, (_, index) => 100 + index / 10),
    )

    const ticks = hourTicks(hours, zone)

    expect(ticks.map(tick => tick.label)).toEqual(['18', '19', '20'])
    expect(ticks.map(tick => tick.at)).toEqual([Date.UTC(2026, 10, 15, 1, 0, 0), Date.UTC(2026, 10, 15, 2, 0, 0), Date.UTC(2026, 10, 15, 3, 0, 0)])
    expect(hourTicks(hours, 'Asia/Kolkata').map(tick => tick.at)).toEqual([Date.UTC(2026, 10, 15, 0, 30, 0), Date.UTC(2026, 10, 15, 1, 30, 0), Date.UTC(2026, 10, 15, 2, 30, 0), Date.UTC(2026, 10, 15, 3, 30, 0)])
  })

  it('sit on the path, interpolated between samples', () => {
    const startsOffMinute = { ...path([10, 20, 30, 40], [100, 110, 120, 130]), startAt: Date.UTC(2026, 10, 15, 0, 59, 30) }

    expect(hourTicks(startsOffMinute, zone)).toEqual([{ at: Date.UTC(2026, 10, 15, 1, 0, 0), label: '18', point: { azimuthDegrees: 105, altitudeDegrees: 15 } }])
  })

  it('skip an hour when the target is under the horizon', () => {
    expect(hourTicks({ ...path([-10, -9], [100, 101]), startAt: Date.UTC(2026, 10, 15, 0, 59, 30) }, zone)).toEqual([])
  })
})

describe('the tree line', () => {
  it('is one known run when every bin is known, closing the circle at 360', () => {
    const runs = lineRuns(flat(10))

    expect(runs).toHaveLength(1)
    expect(runs[0]?.known).toBe(true)
    expect(runs[0]?.points).toHaveLength(361)
    expect(runs[0]?.points[0]).toEqual({ azimuthDegrees: 0, altitudeDegrees: 10 })
    expect(runs[0]?.points.at(-1)).toEqual({ azimuthDegrees: 360, altitudeDegrees: 10 })
    expect(lineNote(flat(10))).toBeUndefined()
  })

  it('is one assumed run at the up line with no file or all bins unknown', () => {
    const runs = lineRuns(flat(null))

    expect(runs).toHaveLength(1)
    expect(runs[0]?.known).toBe(false)
    expect(runs[0]?.points.every(point => point.altitudeDegrees === 30)).toBe(true)
    expect(lineNote(flat(null))).toBe('No horizon file, flat 30° assumed')
    expect(lineNote({ ...flat(10), fileLoaded: false })).toBe('No horizon file, flat 30° assumed')
  })

  it('falls back to the up line at the azimuths where a real horizon has no bin, and no further', () => {
    const holed = bins(Array.from({ length: 360 }, (_, bin) => (bin === 100 || bin === 101 ? null : 10)))
    const runs = lineRuns(holed)

    expect(runs.map(run => run.known)).toEqual([true, false, true])
    expect(runs[0]?.points.at(-1)).toEqual({ azimuthDegrees: 99, altitudeDegrees: 10 })
    expect(runs[1]?.points.map(point => point.azimuthDegrees)).toEqual([99, 100, 101, 102])
    expect(runs[1]?.points.every(point => point.altitudeDegrees === 30)).toBe(true)
    expect(runs[2]?.points[0]).toEqual({ azimuthDegrees: 102, altitudeDegrees: 10 })
    expect(lineNote(holed)).toBe('Flat 30° assumed where the horizon file has no edge')
  })
})

describe('the meridian', () => {
  it('is the south line when the target crosses south of the zenith', () => {
    const crossing = { ...night({ clear: null, highest: { altitudeDegrees: 20, at: start }, transitAt: start + minuteMs, flip: null }), path: path([10, 20, 15], [170, 178, 190]) }

    expect(meridianAzimuths(crossing)).toEqual([180])
  })

  it('is the north line, at both edges of the chart, when it crosses north', () => {
    const crossing = { ...night({ clear: null, highest: { altitudeDegrees: 20, at: start }, transitAt: start + minuteMs, flip: null }), path: path([10, 20, 15], [350, 358, 8]) }

    expect(meridianAzimuths(crossing)).toEqual([0, 360])
  })

  it('is left out with no transit tonight', () => {
    expect(meridianAzimuths(night({ clear: null, highest: { altitudeDegrees: 20, at: start }, transitAt: null, flip: null }))).toEqual([])
  })
})

describe('the facts row', () => {
  const clock = clockIn(zone)
  const at = (hour: number, minute: number) => Date.UTC(2026, 10, 15, hour, minute, 0)
  const highest = { altitudeDegrees: 44.6, at: at(8, 26) }
  const withClear = (clear: NonNullable<HorizonNight['facts']['clear']>, flip: HorizonNight['facts']['flip'] = null) => night({ clear, highest, transitAt: null, flip })
  const base = { which: 'next' as const, clearsAt: at(4, 6), startedBy: { cause: 'trees' as const, azimuthDegrees: 120, compass: 'SE' as const }, clearForSeconds: 8 * 3600 + 10 * 60, endsAt: at(12, 15), endedBy: { cause: 'dark' as const } }

  it('says when it clears and by which gap, how long, the highest, the flip and what ends it', () => {
    expect(nightFacts(withClear(base, { at: at(8, 26), basis: 'mount-limit', limitDegrees: 5 }), clock)).toEqual([
      { label: 'Clears', value: '21:06 · SE gap', note: null },
      { label: 'Clear for', value: '8 h 10', note: null },
      { label: 'Highest', value: '45° at 01:26', note: null },
      { label: 'Flip', value: '01:26', note: "Predicted from the mount's 5° limit" },
      { label: 'Ends', value: '05:15 · dark ends', note: null },
      { label: 'Moon', value: '90% · down all night', note: null },
    ])
  })

  it('says clear at dark when darkness opens it, and since when it is clear now', () => {
    expect(nightFacts(withClear({ ...base, startedBy: { cause: 'dark' } }), clock)[0]).toEqual({ label: 'Clears', value: 'At dark · 21:06', note: null })
    expect(nightFacts(withClear({ ...base, which: 'now' }), clock)[0]).toMatchObject({ label: 'Clear since', value: '21:06 · SE gap' })
  })

  it('names what ends it when the trees come first, and labels a flip at the meridian', () => {
    const facts = nightFacts(withClear({ ...base, endedBy: { cause: 'trees', azimuthDegrees: 300, compass: 'NW' } }, { at: at(8, 26), basis: 'meridian', limitDegrees: null }), clock)

    expect(facts.find(fact => fact.label === 'Ends')?.value).toBe('05:15 · trees NW')
    expect(facts.find(fact => fact.label === 'Flip')).toEqual({ label: 'Flip', value: '01:26', note: 'Predicted at the meridian' })
  })

  it('says a target that never clears does, with no span or end', () => {
    expect(nightFacts(night({ clear: null, highest, transitAt: null, flip: null }), clock).map(fact => fact.label)).toEqual(['Clears', 'Highest', 'Flip', 'Moon'])
    expect(nightFacts(night({ clear: null, highest, transitAt: null, flip: null }), clock)[0]?.value).toBe('Never tonight')
  })

  it('writes spans in hours and minutes, or minutes alone under an hour', () => {
    expect(spanWords(8 * 3600 + 10 * 60)).toBe('8 h 10')
    expect(spanWords(42 * 60)).toBe('42 min')
    expect(spanWords(2 * 3600)).toBe('2 h 00')
  })

  it('names the sweeps the trees came from by their nights', () => {
    expect(lastNightsWords([])).toBeUndefined()
    expect(lastNightsWords(['2026-11-20'])).toBe('Trees from the 11-20 sweep')
    expect(lastNightsWords(['2026-11-18', '2026-11-20'])).toBe('Trees from the 11-18, 11-20 sweeps')
  })
})

describe('the time slider', () => {
  const at = (hour: number, minute: number) => Date.UTC(2026, 10, 15, hour, minute, 0)
  const times = { duskAt: at(0, 0), darkAt: at(1, 0), darkEndsAt: at(5, 0), dawnAt: at(6, 0) }
  const stepMinutes = 5
  const samples = 6 * 60 / stepMinutes + 1
  const high = Array.from({ length: samples }, () => 50)
  const spell = (from: number, until: number) => ({ from, until, startedBy: { cause: 'dark' as const }, endedBy: { cause: 'dark' as const } })

  const sliding = (overrides: Partial<HorizonNight> = {}): HorizonNight => ({
    ...night({ clear: null, highest: { altitudeDegrees: 50, at: at(3, 0) }, transitAt: null, flip: null }),
    times,
    path: { startAt: at(0, 0), stepSeconds: stepMinutes * 60, altitudes: high, azimuths: high.map(() => 100.5), lines: high.map(() => 20) },
    moon: { litFraction: 0.5, altitudes: high, azimuths: high.map(() => 250), upSpans: [] },
    clear: [spell(at(2, 0), at(4, 0))],
    ...overrides,
  })

  const span = nightSpan(sliding())

  describe('the span and its arithmetic', () => {
    it('runs from dusk to dawn', () => {
      expect(span).toEqual({ from: at(0, 0), until: at(6, 0) })
    })

    it('holds a time inside the span', () => {
      expect(clampedTo(span, at(-1, 0))).toBe(at(0, 0))
      expect(clampedTo(span, at(7, 0))).toBe(at(6, 0))
      expect(clampedTo(span, at(2, 0))).toBe(at(2, 0))
    })

    it('turns a time into a fraction of the span and back', () => {
      expect(fractionOf(span, at(3, 0))).toBe(0.5)
      expect(fractionOf(span, at(9, 0))).toBe(1)
      expect(timeAtFraction(span, 0.25)).toBe(at(1, 30))
      expect(timeAtFraction(span, 2)).toBe(at(6, 0))
      expect(timeAtFraction(span, -1)).toBe(at(0, 0))
    })

    it('steps by the minutes asked and stops at either end', () => {
      expect(steppedBy(span, at(2, 0), sliderSettings.stepMinutes)).toBe(at(2, 10))
      expect(steppedBy(span, at(2, 0), -sliderSettings.bigStepMinutes)).toBe(at(1, 0))
      expect(steppedBy(span, at(5, 55), sliderSettings.bigStepMinutes)).toBe(at(6, 0))
      expect(steppedBy(span, at(0, 5), -sliderSettings.bigStepMinutes)).toBe(at(0, 0))
    })
  })

  describe('the lanes', () => {
    it('are the dark hours and the clear spells, cut to the span', () => {
      expect(laneRuns(sliding())).toEqual({ dark: [{ from: at(1, 0), until: at(5, 0) }], clear: [{ from: at(2, 0), until: at(4, 0) }], moon: [] })
      expect(laneRuns(sliding({ clear: [spell(at(-1, 0), at(1, 30)), spell(at(5, 30), at(8, 0)), spell(at(9, 0), at(10, 0))] })).clear).toEqual([
        { from: at(0, 0), until: at(1, 30) },
        { from: at(5, 30), until: at(6, 0) },
      ])
    })

    it('has the Moon-up spans cut to the span', () => {
      const moon = (upSpans: HorizonNight['moon']['upSpans']) => laneRuns(sliding({ moon: { ...sliding().moon, upSpans } })).moon

      expect(moon([{ from: at(-2, 0), until: at(2, 30) }, { from: at(5, 0), until: at(9, 0) }, { from: at(7, 0), until: at(8, 0) }])).toEqual([
        { from: at(0, 0), until: at(2, 30) },
        { from: at(5, 0), until: at(6, 0) },
      ])
    })

    it('have no dark run when the night never gets fully dark', () => {
      expect(laneRuns(sliding({ times: { ...times, darkAt: null, darkEndsAt: null } })).dark).toEqual([])
    })
  })

  describe('where the selected time starts', () => {
    it('is now when now is inside the night', () => {
      expect(startingTime(sliding(), at(3, 17))).toBe(at(3, 17))
      expect(startingTime(sliding(), at(0, 0))).toBe(at(0, 0))
      expect(startingTime(sliding(), at(6, 0))).toBe(at(6, 0))
    })

    it('is the start of the first clear spell when now is outside the night or unknown', () => {
      expect(startingTime(sliding(), at(-2, 0))).toBe(at(2, 0))
      expect(startingTime(sliding(), at(7, 0))).toBe(at(2, 0))
      expect(startingTime(sliding(), undefined)).toBe(at(2, 0))
    })

    it('is the start of darkness when nothing clears, and dusk when it never gets dark', () => {
      expect(startingTime(sliding({ clear: [] }), at(7, 0))).toBe(at(1, 0))
      expect(startingTime(sliding({ clear: [], times: { ...times, darkAt: null, darkEndsAt: null } }), undefined)).toBe(at(0, 0))
    })
  })

  describe('back to now', () => {
    it('goes to now while now is inside the night', () => {
      expect(backTo(sliding(), at(3, 0))).toEqual({ at: at(3, 0), toNow: true })
    })

    it('goes to the start of darkness otherwise', () => {
      expect(backTo(sliding(), at(8, 0))).toEqual({ at: at(1, 0), toNow: false })
      expect(backTo(sliding(), undefined)).toEqual({ at: at(1, 0), toNow: false })
      expect(backTo(sliding({ times: { ...times, darkAt: null, darkEndsAt: null } }), undefined)).toEqual({ at: at(0, 0), toNow: false })
    })
  })

  describe('the readout', () => {
    it('says clear with the altitude inside a clear spell', () => {
      expect(readoutAt(sliding(), at(3, 0))).toEqual({ altitude: '50° up', clear: true, verdict: 'Clear' })
      expect(clearAt(sliding(), at(3, 0))).toBe(true)
      expect(clearAt(sliding(), at(4, 30))).toBe(false)
    })

    it('says twilight outside the dark hours', () => {
      expect(readoutAt(sliding({ clear: [] }), at(0, 30))).toEqual({ altitude: '50° up', clear: false, verdict: 'Not clear: twilight' })
      expect(readoutAt(sliding({ clear: [], times: { ...times, darkAt: null, darkEndsAt: null } }), at(3, 0)).verdict).toBe('Not clear: twilight')
    })

    it('says behind the trees in the dark when the target is under the mapped line', () => {
      const low = sliding({ clear: [], path: { ...sliding().path, altitudes: high.map(() => 12), lines: high.map(() => 20) } })

      expect(readoutAt(low, at(3, 0))).toEqual({ altitude: '12° up', clear: false, verdict: 'Not clear: behind the trees' })
    })

    it('names the flat line instead of the trees where the horizon has no bins', () => {
      const unmapped = sliding({ clear: [], horizon: flat(null), path: { ...sliding().path, altitudes: high.map(() => 12) } })

      expect(readoutAt(unmapped, at(3, 0)).verdict).toBe('Not clear: under the 30° line')
    })

    it('says below the horizon before twilight or trees', () => {
      const under = sliding({ clear: [], path: { ...sliding().path, altitudes: high.map(() => -5) } })

      expect(readoutAt(under, at(0, 30))).toEqual({ altitude: 'Below the horizon', clear: false, verdict: 'Not clear: below the horizon' })
    })

    it('gives no reason it cannot back with the line, and nothing off the path', () => {
      expect(readoutAt(sliding({ clear: [] }), at(3, 0)).verdict).toBe('Not clear')
      expect(readoutAt(sliding(), at(9, 0)).altitude).toBe('Off the path')
    })

    it('reads as one sentence in the answer zone for a screen reader', () => {
      expect(readoutSentence(sliding(), at(3, 0), clockIn(zone))).toBe(`20:00 ${zoneName(zone, at(3, 0))}, 50° up, clear`)
    })
  })

  describe('the hour track', () => {
    it('has a label for each whole hour of the answer zone inside the span', () => {
      const hours = trackHours({ from: Date.UTC(2026, 10, 15, 0, 30, 0), until: Date.UTC(2026, 10, 15, 3, 10, 0) }, zone)

      expect(hours.map(hour => hour.label)).toEqual(['18', '19', '20'])
    })
  })

  describe('the zone', () => {
    it('is named the way the page names it, in the answer zone', () => {
      expect(zoneName('America/New_York', Date.UTC(2026, 10, 15, 12, 0, 0))).toBe('ET')
    })
  })
})

describe('the Moon on the chart', () => {
  const clock = clockIn(zone)
  const at = (minutes: number) => start + minutes * minuteMs
  const facts = { clear: null, highest: { altitudeDegrees: 20, at: start }, transitAt: null, flip: null }
  const moonOn = (moon: Partial<HorizonNight['moon']>, overrides: Partial<HorizonNight> = {}): HorizonNight => ({
    ...night(facts),
    times: { duskAt: start, darkAt: start, darkEndsAt: start + 4 * minuteMs, dawnAt: start + 4 * minuteMs },
    path: path([40, 40, 40, 40, 40], [100, 100, 100, 100, 100]),
    moon: { litFraction: 0.904, altitudes: [-4, 2, 10, 18, 26], azimuths: [250, 255, 260, 265, 270], upSpans: [{ from: at(0.5), until: at(4) }], ...moon },
    ...overrides,
  })

  describe('the point at a time', () => {
    it('is the sample on a step and the line between two, with the same wrap rule as the path', () => {
      expect(moonPointAt(moonOn({}), at(2))).toEqual({ azimuthDegrees: 260, altitudeDegrees: 10 })
      expect(moonPointAt(moonOn({}), at(2.5))).toEqual({ azimuthDegrees: 262.5, altitudeDegrees: 14 })
      expect(moonPointAt(moonOn({ azimuths: [358, 2, 4, 6, 8] }), at(0.25))).toEqual({ azimuthDegrees: 358, altitudeDegrees: -4 })
    })

    it('is nothing outside the night', () => {
      expect(moonPointAt(moonOn({}), at(-1))).toBeUndefined()
      expect(moonPointAt(moonOn({}), at(4.5))).toBeUndefined()
    })
  })

  describe('the angle between two points of the sky', () => {
    it('is the difference in altitude straight up, and in azimuth along the horizon', () => {
      expect(separationDegrees({ azimuthDegrees: 100, altitudeDegrees: 20 }, { azimuthDegrees: 100, altitudeDegrees: 50 })).toBeCloseTo(30, 9)
      expect(separationDegrees({ azimuthDegrees: 100, altitudeDegrees: 0 }, { azimuthDegrees: 130, altitudeDegrees: 0 })).toBeCloseTo(30, 9)
    })

    it('shrinks with altitude for the same azimuth difference, and goes round the north', () => {
      expect(separationDegrees({ azimuthDegrees: 100, altitudeDegrees: 60 }, { azimuthDegrees: 130, altitudeDegrees: 60 })).toBeCloseTo(15.0, 0)
      expect(separationDegrees({ azimuthDegrees: 350, altitudeDegrees: 0 }, { azimuthDegrees: 10, altitudeDegrees: 0 })).toBeCloseTo(20, 9)
    })

    it('is a half turn between opposite points and zero for the same one', () => {
      expect(separationDegrees({ azimuthDegrees: 0, altitudeDegrees: 0 }, { azimuthDegrees: 180, altitudeDegrees: 0 })).toBeCloseTo(180, 9)
      expect(separationDegrees({ azimuthDegrees: 77, altitudeDegrees: 33 }, { azimuthDegrees: 77, altitudeDegrees: 33 })).toBe(0)
    })
  })

  describe('the mark at the selected time', () => {
    it('says the lit percent and the angle from the target, with the Moon where it is', () => {
      const mark = moonMarkAt(moonOn({}), at(2))

      expect(mark?.point).toEqual({ azimuthDegrees: 260, altitudeDegrees: 10 })
      expect(mark?.words).toBe('Moon 90% · 127° from M 42')
    })

    it('is nothing while the Moon is down, or outside the night', () => {
      expect(moonMarkAt(moonOn({}), at(0))).toBeUndefined()
      expect(moonMarkAt(moonOn({}), at(5))).toBeUndefined()
    })
  })

  describe('the path', () => {
    it('is drawn only where the Moon is up, and breaks where it sets and rises again', () => {
      expect(moonPieces(moonOn({})).map(piece => piece.points.map(point => point.altitudeDegrees))).toEqual([[2, 10, 18, 26]])
      expect(moonPieces(moonOn({ altitudes: [4, -2, 6, 8, -1] })).map(piece => piece.points.length)).toEqual([1, 2])
      expect(moonPieces(moonOn({ altitudes: [-4, -3, -2, -1, -5] }))).toEqual([])
    })
  })

  describe('the fact', () => {
    const moonFact = (night: HorizonNight) => nightFacts(night, clock).find(fact => fact.label === 'Moon')

    it('says the lit percent and when the Moon rises, from dusk, or sets', () => {
      expect(moonFact(moonOn({ upSpans: [{ from: at(1), until: at(4) }] }))).toEqual({ label: 'Moon', value: '90% · up from 17:31', note: null })
      expect(moonFact(moonOn({ upSpans: [{ from: at(0), until: at(3) }] }))?.value).toBe('90% · up to 17:33')
      expect(moonFact(moonOn({ upSpans: [{ from: at(1), until: at(3) }] }))?.value).toBe('90% · up 17:31 to 17:33')
    })

    it('says up all night, or down all night', () => {
      expect(moonPercent(moonOn({}))).toBe(90)
      expect(moonFact(moonOn({ upSpans: [{ from: at(0), until: at(4) }] }))?.value).toBe('90% · up all night')
      expect(moonFact(moonOn({ upSpans: [] }))?.value).toBe('90% · down all night')
    })
  })
})
