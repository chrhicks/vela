import { describe, expect, it } from 'vitest'
import { angularDistance, fromMount, toMount, type EquatorialPosition } from '@vela/rig-sky'
import { syntheticSite } from '@vela/rig-testing'

const velaCoordinates = new URL('../../../apps/server/src/astronomy/coordinates.ts', import.meta.url).href

const vela: {
  toMount: typeof toMount
  fromMount: typeof fromMount
  angularDistance: typeof angularDistance
} = await import(velaCoordinates)

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

describe('@vela/rig-sky against the copy in Vela', () => {
  it('has 1,000 distinct random cases', () => {
    expect(new Set(cases.map(item => `${item.position.raDegrees}:${item.at.getTime()}`)).size).toBe(1000)
  })

  it('toMount agrees to under 1e-9 degrees', () => {
    for (const { position, at } of cases)
      expect(vela.angularDistance(toMount(position, 'topocentric', at, syntheticSite), vela.toMount(position, 'topocentric', at, syntheticSite))).toBeLessThan(1e-9)
  })

  it('fromMount agrees to under 1e-9 degrees', () => {
    for (const { position, at } of cases)
      expect(vela.angularDistance(fromMount(position, 'topocentric', at, syntheticSite), vela.fromMount(position, 'topocentric', at, syntheticSite))).toBeLessThan(1e-9)
  })

  it('angularDistance agrees to under 1e-9 degrees', () => {
    for (let index = 1; index < cases.length; index++) {
      const a = cases[index - 1]!.position
      const b = cases[index]!.position

      expect(Math.abs(angularDistance(a, b) - vela.angularDistance(a, b))).toBeLessThan(1e-9)
    }
  })

  it('treats the j2000 frame as no conversion, as Vela does', () => {
    const { position, at } = cases[0]!

    expect(toMount(position, 'j2000', at, syntheticSite)).toEqual(vela.toMount(position, 'j2000', at, syntheticSite))
  })

  it('refuses a frame it does not know, as Vela does', () => {
    const { position, at } = cases[0]!

    expect(() => toMount(position, 'galactic', at, syntheticSite)).toThrow(/not supported/)
    expect(() => vela.toMount(position, 'galactic', at, syntheticSite)).toThrow(/not supported/)
  })

  it('goes there and back to within a tenth of an arcsecond', () => {
    for (const { position, at } of cases.slice(0, 200)) {
      const there = toMount(position, 'topocentric', at, syntheticSite)

      expect(angularDistance(fromMount(there, 'topocentric', at, syntheticSite), position)).toBeLessThan(0.1 / 3600)
    }
  })

  it('moves a position by roughly twenty arcminutes in 2026, which is why pointing compares in one frame', () => {
    const at = new Date(Date.UTC(2026, 9, 26, 23, 45))
    const position = { raDegrees: 280, decDegrees: -5 }
    const shift = angularDistance(position, toMount(position, 'topocentric', at, syntheticSite))

    expect(shift * 60).toBeGreaterThan(15)
    expect(shift * 60).toBeLessThan(25)
  })
})
