import { describe, expect, it } from 'vitest'
import { nightTimes } from './darkness.ts'

const phoenix = { latitudeDegrees: 33.45, longitudeDegrees: -112.07, elevationMeters: 331 }
const hourMs = 3_600_000

describe('the night for a site', () => {
  it('finds tonight from the afternoon: dusk, dark, dark ends and dawn in order', () => {
    const afternoon = Date.parse('2026-11-08T22:00:00Z')
    const night = nightTimes(phoenix, afternoon)

    expect(night).toBeDefined()
    expect(night!.duskAt).toBeGreaterThan(Date.parse('2026-11-09T00:00:00Z'))
    expect(night!.duskAt).toBeLessThan(Date.parse('2026-11-09T01:30:00Z'))
    expect(night!.darkAt! - night!.duskAt).toBeGreaterThan(0.75 * hourMs)
    expect(night!.darkAt! - night!.duskAt).toBeLessThan(1.5 * hourMs)
    expect(night!.darkEndsAt!).toBeGreaterThan(night!.darkAt!)
    expect(night!.dawnAt).toBeGreaterThan(night!.darkEndsAt!)
    expect(night!.dawnAt - night!.duskAt).toBeGreaterThan(11 * hourMs)
    expect(night!.dawnAt - night!.duskAt).toBeLessThan(14 * hourMs)
  })

  it('keeps the same night after midnight', () => {
    const afternoon = nightTimes(phoenix, Date.parse('2026-11-08T22:00:00Z'))!
    const small = nightTimes(phoenix, Date.parse('2026-11-09T10:00:00Z'))!

    expect(small.duskAt).toBe(afternoon.duskAt)
  })

  it('moves to the next night once dawn has passed', () => {
    const afternoon = nightTimes(phoenix, Date.parse('2026-11-08T22:00:00Z'))!
    const morning = nightTimes(phoenix, afternoon.dawnAt + hourMs)!

    expect(morning.duskAt).toBeGreaterThan(afternoon.dawnAt)
    expect(morning.duskAt - afternoon.duskAt).toBeGreaterThan(23 * hourMs)
    expect(morning.duskAt - afternoon.duskAt).toBeLessThan(25 * hourMs)
  })
})
