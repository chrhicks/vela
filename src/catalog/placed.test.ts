import { SiderealTime } from 'astronomy-engine'
import { describe, expect, it } from 'vitest'
import { makePlacedTargets } from './placed.ts'
import { testCatalog } from './testing.ts'

const phoenix = { latitudeDegrees: 33.45, longitudeDegrees: -112.07, elevationMeters: 331 }
const settings = { searchResults: 10, upLineDegrees: 30, bestPlacedRows: 10, bestPlacedMinArcminutes: 10 }

const whenOverhead = (raDegrees: number) => {
  const start = Date.UTC(2026, 10, 15, 0, 0, 0)
  const hoursToGo = ((((raDegrees / 15 - (SiderealTime(new Date(start)) + phoenix.longitudeDegrees / 15)) % 24) + 24) % 24) / 1.0027379093

  return start + hoursToGo * 3_600_000
}

const andromedaOverhead = whenOverhead(10.68)
const orionOverhead = whenOverhead(83.82)

describe('targets with their place in the sky', () => {
  it('lists the targets that are up, are large enough and have a common name, the most cited first', () => {
    const placed = makePlacedTargets({ catalog: testCatalog, site: () => phoenix, settings })

    expect(placed.bestPlaced(andromedaOverhead).map(found => found.id)).toEqual(['andromeda', 'triangulum'])
    expect(placed.bestPlaced(orionOverhead).map(found => found.id)).toEqual(['orion', 'andromeda', 'triangulum'])
  })

  it('leaves out a target smaller than the setting and stops at the number of rows', () => {
    const small = makePlacedTargets({ catalog: testCatalog, site: () => phoenix, settings: { ...settings, bestPlacedMinArcminutes: 1 } })
    const one = makePlacedTargets({ catalog: testCatalog, site: () => phoenix, settings: { ...settings, bestPlacedRows: 1 } })

    expect(small.bestPlaced(orionOverhead).map(found => found.id)).toEqual(['orion', 'andromeda', 'horsehead', 'triangulum'])
    expect(one.bestPlaced(orionOverhead).map(found => found.id)).toEqual(['orion'])
  })

  it('gives each listed target its altitude', () => {
    const [first] = makePlacedTargets({ catalog: testCatalog, site: () => phoenix, settings }).bestPlaced(andromedaOverhead)

    expect(first?.placement?.altitudeDegrees).toBeGreaterThan(80)
    expect(first).toMatchObject({ name: 'M 31', commonName: 'Andromeda Galaxy', constellation: 'Andromeda' })
  })

  it('finds a target by text with its place, or without one while the site is not known', () => {
    const known = makePlacedTargets({ catalog: testCatalog, site: () => phoenix, settings })
    const unknown = makePlacedTargets({ catalog: testCatalog, site: () => undefined, settings })

    expect(known.search('m 31', andromedaOverhead)[0]?.placement?.line.above).toBe('until')
    expect(unknown.search('m 31', andromedaOverhead)[0]).toMatchObject({ id: 'andromeda', placement: null })
    expect(unknown.bestPlaced(andromedaOverhead)).toEqual([])
  })
})
