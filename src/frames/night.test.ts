import { describe, expect, it } from 'vitest'
import { nightOf } from './night.ts'

const phoenix = { zone: 'America/Phoenix', changesAtHour: 12 }
const newYork = { zone: 'America/New_York', changesAtHour: 12 }

describe('nightOf', () => {
  it('names a night for the evening it starts', () => {
    expect(nightOf(Date.UTC(2026, 10, 8, 3, 0), phoenix)).toBe('2026-11-07')
    expect(nightOf(Date.UTC(2026, 10, 8, 12, 0), phoenix)).toBe('2026-11-07')
  })

  it('starts the next night at the change hour', () => {
    expect(nightOf(Date.UTC(2026, 10, 8, 18, 59), phoenix)).toBe('2026-11-07')
    expect(nightOf(Date.UTC(2026, 10, 8, 19, 0), phoenix)).toBe('2026-11-08')
  })

  it('uses the zone given, with its daylight saving', () => {
    expect(nightOf(Date.UTC(2026, 10, 3, 3, 30), newYork)).toBe('2026-11-02')
    expect(nightOf(Date.UTC(2026, 6, 3, 3, 30), newYork)).toBe('2026-07-02')
    expect(nightOf(Date.UTC(2026, 10, 2, 17, 0), newYork)).toBe('2026-11-02')
  })

  it('carries a night across a month end', () => {
    expect(nightOf(Date.UTC(2026, 11, 1, 8, 0), phoenix)).toBe('2026-11-30')
  })
})
