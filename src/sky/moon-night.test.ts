import { Body, Equator, Horizon, Illumination, Observer } from 'astronomy-engine'
import { describe, expect, it } from 'vitest'
import { nightTimes } from './darkness.ts'
import { moonNight } from './moon-night.ts'
import { skyTonight } from './tonight.ts'

const phoenix = { latitudeDegrees: 33.45, longitudeDegrees: -112.07, elevationMeters: 331 }
const observer = new Observer(phoenix.latitudeDegrees, phoenix.longitudeDegrees, phoenix.elevationMeters)
const hourMs = 3_600_000

const nightOf = (day: number) => nightTimes(phoenix, Date.UTC(2026, 10, day, 22, 0, 0))!
const moonOn = (day: number) => moonNight({ site: phoenix, night: nightOf(day), stepSeconds: 60, decimals: 2 })

const altitudeAt = (at: number) => {
  const date = new Date(at)
  const moon = Equator(Body.Moon, date, observer, true, true)

  return Horizon(date, observer, moon.ra, moon.dec, 'normal').altitude
}

describe("the Moon's night", () => {
  it('samples the same steps as the target path, in rounded parallel arrays', () => {
    const night = nightOf(15)
    const moon = moonOn(15)
    const count = Math.floor((night.dawnAt - night.duskAt) / 60_000) + 1

    expect(moon.altitudes).toHaveLength(count)
    expect(moon.azimuths).toHaveLength(count)
    expect(moon.azimuths.every(azimuth => azimuth >= 0 && azimuth < 360)).toBe(true)
    expect(moon.altitudes.every(altitude => altitude === Math.round(altitude * 100) / 100)).toBe(true)
    expect(moon.altitudes[30]).toBeCloseTo(altitudeAt(night.duskAt + 30 * 60_000), 2)
  })

  it('takes the lit fraction at the middle of the night, to the rounding', () => {
    const night = nightOf(15)

    expect(moonOn(15).litFraction).toBeCloseTo(Illumination(Body.Moon, new Date((night.duskAt + night.dawnAt) / 2)).phase_fraction, 2)
  })

  it('has one span from dusk to the set when the Moon is up at dusk and sets in the night', () => {
    const night = nightOf(15)
    const [span, ...others] = moonOn(15).upSpans

    expect(others).toEqual([])
    expect(span!.from).toBe(night.duskAt)
    expect(span!.until).toBeGreaterThan(night.duskAt + 3 * hourMs)
    expect(span!.until).toBeLessThan(night.dawnAt)
    expect(Math.abs(altitudeAt(span!.until))).toBeLessThan(0.01)
  })

  it('has one span from the rise to dawn when the Moon comes up in the night', () => {
    const night = nightOf(1)
    const [span, ...others] = moonOn(1).upSpans

    expect(others).toEqual([])
    expect(span!.until).toBe(night.dawnAt)
    expect(span!.from).toBeGreaterThan(night.duskAt)
    expect(Math.abs(altitudeAt(span!.from))).toBeLessThan(0.01)
  })

  it('is up for the whole night, or down for the whole night, with one span or none', () => {
    const night = nightOf(23)

    expect(moonOn(23).upSpans).toEqual([{ from: night.duskAt, until: night.dawnAt }])
    expect(moonOn(8).upSpans).toEqual([])
  })

  it('is up where the Moon fact says up, by the one rule of tonight.ts', () => {
    for (const day of [1, 10, 15, 23]) {
      const night = nightOf(day)
      const moon = moonOn(day)

      for (const index of [0, 120, 300, 480, moon.altitudes.length - 1]) {
        const at = night.duskAt + index * 60_000

        expect(moon.altitudes[index]! > 0).toBe(skyTonight(phoenix, at).moon.up)
        expect(moon.upSpans.some(span => at >= span.from && at <= span.until)).toBe(moon.altitudes[index]! > 0)
      }
    }
  })
})
