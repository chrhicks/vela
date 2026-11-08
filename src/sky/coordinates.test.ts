import { describe, expect, it } from 'vitest'
import { angularDistance, fromMount, toMount, type EquatorialPosition } from './coordinates.ts'

function random(seed: number) {
  let state = seed

  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const next = random(20261031)

const cases = Array.from({ length: 1000 }, () => ({
  position: { raDegrees: next() * 360, decDegrees: Math.asin(2 * next() - 1) * (180 / Math.PI) } satisfies EquatorialPosition,
  at: new Date(Date.UTC(2026, 0, 1) + next() * 2 * 365 * 24 * 3600 * 1000),
}))

describe('sky coordinates', () => {
  it('has 1,000 distinct random cases', () => {
    expect(new Set(cases.map(item => `${item.position.raDegrees}:${item.at.getTime()}`)).size).toBe(1000)
  })

  it('goes there and back to within a tenth of an arcsecond', () => {
    for (const { position, at } of cases.slice(0, 200)) {
      expect(angularDistance(fromMount(toMount(position, at), at), position)).toBeLessThan(0.1 / 3600)
    }
  })

  it('precesses a made-up target by the standard rate, about twenty arcminutes since 2000', () => {
    const target = { raDegrees: 0, decDegrees: 0 }
    const at = new Date(Date.UTC(2026, 10, 8))
    const years = 26.86
    const shift = angularDistance(target, toMount(target, at))
    const expectedArcminutes = (years * 50.29) / 60

    expect(expectedArcminutes).toBeGreaterThan(20)
    expect(Math.abs(shift * 60 - expectedArcminutes)).toBeLessThan(1)
  })
})
