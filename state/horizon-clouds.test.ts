import { describe, expect, it } from 'vitest'
import type { Forecast } from './forecast.ts'
import { cloudAt, cloudHours, cloudLabels, cloudWords, cloudyRuns, forecastClearCell, forecastNote, withForecastClear } from './horizon-clouds.ts'
import type { HorizonNight } from './horizon-night.ts'

const hour = 3_600_000
const midnight = Date.parse('2026-11-21T00:00:00Z')
const at = (h: number) => midnight + h * hour
const span = { from: at(1) + 15 * 60_000, until: at(6) }
const clock = (time: number) => `${String(Math.floor(((time - midnight) % (24 * hour)) / hour)).padStart(2, '0')}:${String(Math.round(((time - midnight) % hour) / 60_000)).padStart(2, '0')}`

const forecastOf = (covers: ReadonlyArray<readonly [number, number | null, 'nws' | 'open-meteo' | null]>, nws = { ageSeconds: 300, failing: false }): Forecast => ({
  at: at(0),
  cloudyPercent: 50,
  hours: covers.map(([h, coverPercent, source]) => ({ at: at(h), coverPercent, source })),
  nws,
  openMeteo: { ageSeconds: 600, failing: false },
})

const forecast = forecastOf([[1, 0, 'nws'], [2, 20, 'nws'], [3, 50, 'nws'], [4, 90, 'open-meteo'], [5, null, null]])

describe('the cloud hours of a night', () => {
  it('cut the hours to the night, an hour with no forecast showing as unknown and 0 as clear', () => {
    const hours = cloudHours(span, forecast)

    expect(hours.map(found => [found.from, found.until, found.coverPercent])).toEqual([[span.from, at(2), 0], [at(2), at(3), 20], [at(3), at(4), 50], [at(4), at(5), 90], [at(5), at(6), null]])
  })

  it('are all unknown without a forecast', () => {
    expect(cloudHours(span, undefined).every(found => found.coverPercent === null && found.source === null)).toBe(true)
  })

  it('join the hours at or above the cloudy percent into runs, unknown hours not being cloudy', () => {
    expect(cloudyRuns(cloudHours(span, forecast), 50)).toEqual([{ from: at(3), until: at(5) }])
    expect(cloudyRuns(cloudHours(span, forecast), 95)).toEqual([])
  })

  it('give the cover at a time, or say it is unknown', () => {
    const hours = cloudHours(span, forecast)

    expect(cloudWords(hours, at(3) + 1000)).toBe('Cloud 50%')
    expect(cloudWords(hours, span.from)).toBe('Cloud 0%')
    expect(cloudWords(hours, at(5) + 1000)).toBe('Cloud unknown')
    expect(cloudAt(hours, span.until)?.from).toBe(at(5))
  })
})

const night = (clear: HorizonNight['facts']['clear']): HorizonNight =>
  ({ target: { id: 'orion', name: 'M 42', commonName: null }, path: { startAt: span.from, stepSeconds: 3600, altitudes: [10, 30, 40, 40, 30, 10], azimuths: [100, 110, 120, 130, 140, 150], lines: [5, 5, 5, 5, 5, 5] }, facts: { clear, highest: { altitudeDegrees: 40, at: at(3) }, transitAt: null, flip: null } }) as unknown as HorizonNight

const spell = { which: 'next' as const, clearsAt: at(2), startedBy: { cause: 'dark' as const }, clearForSeconds: 4 * 3600, endsAt: at(6), endedBy: { cause: 'dark' as const } }

describe('the forecast clear time', () => {
  it('is the clear spell less its cloudy hours', () => {
    expect(forecastClearCell(night(spell), cloudHours(span, forecast), 50)).toEqual({ label: 'Forecast clear', value: '2 h 00', note: '1 h 00 with no forecast' })
  })

  it('has no note when every hour of the spell has a forecast', () => {
    const known = forecastOf([[1, 0, 'nws'], [2, 0, 'nws'], [3, 60, 'nws'], [4, 10, 'nws'], [5, 10, 'nws']])

    expect(forecastClearCell(night(spell), cloudHours(span, known), 50)).toEqual({ label: 'Forecast clear', value: '3 h 00', note: null })
  })

  it('says unknown when the spell has no forecast at all', () => {
    expect(forecastClearCell(night(spell), cloudHours(span, undefined), 50)).toEqual({ label: 'Forecast clear', value: 'Unknown', note: 'No cloud forecast for this spell' })
  })

  it('is not given for a target that never clears, and goes beside Clear for', () => {
    expect(forecastClearCell(night(null), cloudHours(span, forecast), 50)).toBeUndefined()

    const cells = [{ label: 'Clears', value: 'a', note: null }, { label: 'Clear for', value: 'b', note: null }, { label: 'Ends', value: 'c', note: null }]
    const cell = { label: 'Forecast clear', value: 'd', note: null }

    expect(withForecastClear(cells, cell).map(found => found.label)).toEqual(['Clears', 'Clear for', 'Forecast clear', 'Ends'])
    expect(withForecastClear(cells, undefined)).toEqual(cells)
  })
})

describe('the clouds label and the forecast note', () => {
  it('labels each cloudy stretch with its hours, where the target is up', () => {
    const runs = cloudyRuns(cloudHours(span, forecast), 50)

    const labels = cloudLabels(night(spell), runs, clock)

    expect(labels.map(label => label.words)).toEqual(['Clouds 03 to 05 · forecast'])
    expect(labels[0]?.point).toEqual({ azimuthDegrees: 120, altitudeDegrees: 40 })
  })

  it('names each source in use with its age, and says when a refresh is failing', () => {
    expect(forecastNote(forecast, cloudHours(span, forecast))).toBe('Clouds: NWS, 5 min old and Open-Meteo, 10 min old')
    expect(forecastNote(forecastOf([[2, 10, 'nws']], { ageSeconds: 7200, failing: true }), cloudHours(span, forecastOf([[2, 10, 'nws']], { ageSeconds: 7200, failing: true })))).toBe('Clouds: NWS, 2 h 00 old, refresh failing')
  })

  it('says there is no forecast', () => {
    expect(forecastNote(undefined, cloudHours(span, undefined))).toBe('No cloud forecast')
    expect(forecastNote(forecastOf([]), cloudHours(span, forecastOf([])))).toBe('No cloud forecast')
  })
})
