import { describe, expect, it } from 'vitest'
import { skyTonight } from './tonight.ts'

const phoenix = { latitudeDegrees: 33.45, longitudeDegrees: -112.07, elevationMeters: 331 }
const hour = 3_600_000
const midnightAfter = (year: number, month: number, day: number) => Date.UTC(year, month - 1, day + 1, 7, 0, 0)

describe('the sky tonight', () => {
  it('gives the hours of full darkness around a midnight', () => {
    const at = midnightAfter(2026, 11, 14)
    const { dark } = skyTonight(phoenix, at)

    expect(dark).not.toBeNull()
    expect(dark!.from).toBeLessThan(at)
    expect(dark!.until).toBeGreaterThan(at)
    expect((dark!.until - dark!.from) / hour).toBeGreaterThan(10)
    expect((dark!.until - dark!.from) / hour).toBeLessThan(12)
  })

  it('has a full Moon up at midnight, setting in the morning', () => {
    const at = midnightAfter(2026, 11, 24)
    const { moon } = skyTonight(phoenix, at)

    expect(moon.litFraction).toBeGreaterThan(0.97)
    expect(moon.up).toBe(true)
    expect((moon.changesAt! - at) / hour).toBeGreaterThan(4)
    expect((moon.changesAt! - at) / hour).toBeLessThan(10)
  })

  it('has a new Moon down at midnight, rising near sunrise', () => {
    const at = midnightAfter(2026, 11, 9)
    const { moon } = skyTonight(phoenix, at)

    expect(moon.litFraction).toBeLessThan(0.05)
    expect(moon.up).toBe(false)
    expect(moon.changesAt).toBeGreaterThan(at)
  })
})
