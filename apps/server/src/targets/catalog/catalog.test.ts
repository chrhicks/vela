import { describe, expect, it } from 'vitest'
import { getTarget, listTargets, searchTargets } from './index.js'

describe('local target catalog', () => {
  it('resolves familiar names to the correct physical source records', () => {
    const identities = [
      [' M  013 ', 'ngc6205'],
      ['M31', 'ngc0224'],
      ['Andromeda Galaxy', 'ngc0224'],
      ['Crescent', 'ngc6888'],
      ['North America', 'ngc7000'],
      ['Heart', 'ic1805'],
      ['Soul', 'ic1848'],
      ['Horsehead', 'b033'],
      ['Barnard 33', 'b033'],
      ['Flame', 'ngc2024'],
      ['NGC 0224', 'ngc0224'],
      ['B33', 'b033'],
    ]

    for (const [query, id] of identities) {
      expect(searchTargets(query!)[0]?.id, query).toBe(id)
    }

    expect(searchTargets('Flame').map(target => target.id)).not.toContain('ic0434')
    expect(getTarget('ic0434')?.catalogName).toBe('IC 434')
  })

  it('retains J2000 coordinates and source extents, including unknown minor axes', () => {
    expect(getTarget('ngc6205')).toMatchObject({
      type: 'Globular cluster',
      raDegrees: 250.42345833,
      decDegrees: 36.46130556,
      majorAxisArcminutes: 16.5,
      minorAxisArcminutes: null,
    })
    expect(getTarget('b033')).toMatchObject({
      type: 'Dark nebula',
      raDegrees: 85.24583333,
      decDegrees: -2.45833333,
    })
    expect(getTarget('ic1805')?.type).toBe('Star cluster and nebula')
  })

  it('keeps a bounded deterministic search and does not invent unknown targets', () => {
    expect(searchTargets('NGC 7000', 1)[0]?.id).toBe('ngc7000')
    expect(searchTargets('ngc', 3)).toHaveLength(3)
    expect(searchTargets('not a known object')).toEqual([])
    expect(searchTargets('   ', 2)).toEqual(listTargets().slice(0, 2))
    expect(getTarget('unknown')).toBeUndefined()

    for (const limit of [0, -1, 201, 1.5, NaN]) {
      expect(() => searchTargets('M13', limit)).toThrow(RangeError)
    }
  })

  it('bundles unique usable positions and protects the shared catalog from mutation', () => {
    const targets = listTargets()
    expect(targets.length).toBeGreaterThan(13000)
    expect(new Set(targets.map(target => target.id)).size).toBe(targets.length)

    for (const target of targets) {
      expect(target.raDegrees).toBeGreaterThanOrEqual(0)
      expect(target.raDegrees).toBeLessThan(360)
      expect(target.decDegrees).toBeGreaterThanOrEqual(-90)
      expect(target.decDegrees).toBeLessThanOrEqual(90)
    }

    expect(Object.isFrozen(targets)).toBe(true)
    expect(Object.isFrozen(targets[0])).toBe(true)
    expect(Object.isFrozen(targets[0]?.aliases)).toBe(true)
  })
})
