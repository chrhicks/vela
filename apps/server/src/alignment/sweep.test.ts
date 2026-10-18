import { describe, expect, it } from 'vitest'
import { chooseSweepRate, legCount, nearestAdvertisedRate } from './sweep.js'

function mount(...rates: number[]) {
  return { primaryAxisRates: rates.map(degreesPerSecond => ({ name: `${degreesPerSecond}`, degreesPerSecond })) }
}

describe('chooseSweepRate', () => {
  it('takes the fastest advertised rate at or below 1°/s', () => {
    expect(chooseSweepRate(mount(0.0042, 0.2507, 3.008))).toBe(0.2507)
    expect(chooseSweepRate(mount(0.2507, 0.998, 3.008))).toBe(0.998)
    expect(chooseSweepRate(mount(1, 2))).toBe(1)
  })

  it('takes the slowest when every advertised rate is above 1°/s', () => {
    expect(chooseSweepRate(mount(6, 3.008))).toBe(3.008)
  })

  it('takes a configured rate only if the mount advertises it, within 1%', () => {
    expect(chooseSweepRate(mount(0.2507, 3.008), 3.008)).toBe(3.008)
    expect(chooseSweepRate(mount(0.2507, 3.008), 0.25)).toBe(0.2507)
    expect(() => chooseSweepRate(mount(0.2507, 3.008), 1)).toThrow('not one the mount advertises (0.2507°/s, 3.008°/s)')
  })

  it('uses the configured rate, else 1°/s, for a mount that advertises none', () => {
    expect(chooseSweepRate({})).toBe(1)
    expect(chooseSweepRate({}, 0.5)).toBe(0.5)
  })

  it('refuses an empty rate table', () => {
    expect(() => chooseSweepRate(mount())).toThrow('reports no supported primary axis rate')
  })

  it('ignores the sign of an advertised rate', () => {
    expect(chooseSweepRate(mount(-0.2507, 0.2507, -3.008))).toBe(0.2507)
  })
})

describe('nearestAdvertisedRate', () => {
  it('picks the advertised rate nearest the preferred one', () => {
    expect(nearestAdvertisedRate(mount(0.0042, 0.2507, 3.008), 0.25)).toBe(0.2507)
    expect(nearestAdvertisedRate({}, 0.25)).toBe(0.25)
  })
})

describe('legCount', () => {
  it('splits a sweep so no leg lasts over the limit', () => {
    expect(legCount(57.25, 0.2507, 100)).toBe(3)
    expect(legCount(57.25, 0.2507, 50)).toBe(5)
    expect(legCount(57.25, 1, 100)).toBe(1)
    expect(legCount(57.25, 3.008, 100)).toBe(1)
  })
})
