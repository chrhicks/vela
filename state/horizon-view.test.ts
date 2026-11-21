import { describe, expect, it } from 'vitest'
import type { HorizonNight } from './horizon-night.ts'
import { clockIn, hourTicks, lastNightsWords, lineNote, lineRuns, meridianAzimuths, nightFacts, nowPoint, pathPieces, skyPointAt, spanWords } from './horizon-view.ts'

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
    expect(nightFacts(night({ clear: null, highest, transitAt: null, flip: null }), clock).map(fact => fact.label)).toEqual(['Clears', 'Highest', 'Flip'])
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
