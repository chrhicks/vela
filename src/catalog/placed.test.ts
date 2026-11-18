import { SiderealTime } from 'astronomy-engine'
import { describe, expect, it } from 'vitest'
import type { BestPlacedAsked } from '../../state/targets.ts'
import { skyTonight } from '../sky/tonight.ts'
import { makePlacedTargets } from './placed.ts'
import { testCatalog } from './testing.ts'

const phoenix = { latitudeDegrees: 33.45, longitudeDegrees: -112.07, elevationMeters: 331 }
const settings = { searchResults: 10, upLineDegrees: 30, bestPlacedRows: 10, bestPlacedMinArcminutes: 10 }

const everything: BestPlacedAsked = { show: 'all', order: 'placed' }

const bubbleFraming = { raDegrees: 83.9, decDegrees: -5.2, at: 1794360132000 }
const lastCentreNear = (position: { readonly raDegrees: number }) => (Math.abs(position.raDegrees - 83.82) < 0.01 ? bubbleFraming : undefined)

const whenOverhead = (raDegrees: number) => {
  const start = Date.UTC(2026, 10, 15, 0, 0, 0)
  const hoursToGo = ((((raDegrees / 15 - (SiderealTime(new Date(start)) + phoenix.longitudeDegrees / 15)) % 24) + 24) % 24) / 1.0027379093

  return start + hoursToGo * 3_600_000
}

const andromedaOverhead = whenOverhead(10.68)
const orionOverhead = whenOverhead(83.82)

describe('targets with their place in the sky', () => {
  it('lists the targets that are up, are large enough and have a common name, the most cited first', () => {
    const placed = makePlacedTargets({ catalog: testCatalog, lastCentreNear, site: () => phoenix, settings })

    expect(placed.bestPlaced(andromedaOverhead, everything).map(found => found.id)).toEqual(['andromeda', 'triangulum', 'soul'])
    expect(placed.bestPlaced(orionOverhead, everything).map(found => found.id)).toEqual(['orion', 'andromeda', 'triangulum', 'soul'])
  })

  it('leaves out a target smaller than the setting and stops at the number of rows', () => {
    const small = makePlacedTargets({ catalog: testCatalog, lastCentreNear, site: () => phoenix, settings: { ...settings, bestPlacedMinArcminutes: 1 } })
    const one = makePlacedTargets({ catalog: testCatalog, lastCentreNear, site: () => phoenix, settings: { ...settings, bestPlacedRows: 1 } })

    expect(small.bestPlaced(orionOverhead, everything).map(found => found.id)).toEqual(['orion', 'andromeda', 'horsehead', 'triangulum', 'soul'])
    expect(one.bestPlaced(orionOverhead, everything).map(found => found.id)).toEqual(['orion'])
  })

  it('lists only the targets hinted for dual band when asked, cutting the rows after leaving out the rest', () => {
    const placed = makePlacedTargets({ catalog: testCatalog, lastCentreNear, site: () => phoenix, settings })
    const one = makePlacedTargets({ catalog: testCatalog, lastCentreNear, site: () => phoenix, settings: { ...settings, bestPlacedRows: 1 } })

    expect(placed.bestPlaced(orionOverhead, { show: 'dual-band', order: 'placed' }).map(found => found.id)).toEqual(['orion', 'soul'])
    expect(one.bestPlaced(andromedaOverhead, { show: 'dual-band', order: 'placed' }).map(found => found.id)).toEqual(['soul'])
  })

  it('lists the largest first when asked, by the long side', () => {
    const placed = makePlacedTargets({ catalog: testCatalog, lastCentreNear, site: () => phoenix, settings })

    expect(placed.bestPlaced(orionOverhead, { show: 'all', order: 'largest' }).map(found => found.id)).toEqual(['andromeda', 'orion', 'triangulum', 'soul'])
  })

  it('gives each listed target its altitude', () => {
    const [first] = makePlacedTargets({ catalog: testCatalog, lastCentreNear, site: () => phoenix, settings }).bestPlaced(andromedaOverhead, everything)

    expect(first?.placement?.altitudeDegrees).toBeGreaterThan(80)
    expect(first).toMatchObject({ name: 'M 31', commonName: 'Andromeda Galaxy', constellation: 'Andromeda', dualBandHint: false, sizeArcminutes: { long: 189, short: null } })
  })

  it('finds a target by text with its place, or without one while the site is not known', () => {
    const known = makePlacedTargets({ catalog: testCatalog, lastCentreNear, site: () => phoenix, settings })
    const unknown = makePlacedTargets({ catalog: testCatalog, lastCentreNear, site: () => undefined, settings })

    expect(known.search('m 31', andromedaOverhead)[0]?.placement?.line.above).toBe('until')
    expect(unknown.search('m 31', andromedaOverhead)[0]).toMatchObject({ id: 'andromeda', placement: null })
    expect(known.search('orion', andromedaOverhead)[0]).toMatchObject({ id: 'orion', dualBandHint: true, placement: { lineDegrees: 30 } })
    expect(unknown.bestPlaced(andromedaOverhead, everything)).toEqual([])
  })

  it('gives the facts of one target: its other names, size, constellation and the dual-band hint', () => {
    const placed = makePlacedTargets({ catalog: testCatalog, lastCentreNear, site: () => phoenix, settings })

    expect(placed.facts('orion', orionOverhead)).toMatchObject({ name: 'M 42', commonName: 'Orion Nebula', otherNames: ['Great Orion Nebula'], sizeArcminutes: { long: 90, short: null }, dualBandHint: true, constellation: 'Orion' })
    expect(placed.facts('andromeda', orionOverhead)).toMatchObject({ otherNames: ['NGC 224'], dualBandHint: false, raDegrees: 10.68, decDegrees: 41.27 })
    expect(placed.facts('m3', orionOverhead)).toMatchObject({ otherNames: [], sizeArcminutes: null })
    expect(placed.facts('nowhere', orionOverhead)).toBeUndefined()
  })

  it('hints at dual band for a target in a catalogue of hydrogen regions whatever its type', () => {
    const placed = makePlacedTargets({ catalog: testCatalog, lastCentreNear, site: () => undefined, settings })

    expect(placed.facts('soul', orionOverhead)).toMatchObject({ type: 'OC', dualBandHint: true, placement: null })
    expect(placed.facts('horsehead', orionOverhead)?.dualBandHint).toBe(false)
  })

  it('spells a constellation as the astronomical union does', () => {
    expect(makePlacedTargets({ catalog: testCatalog, lastCentreNear, site: () => undefined, settings }).facts('camelopardalis', orionOverhead)?.constellation).toBe('Camelopardalis')
  })

  it('takes typed coordinates as a target with no catalog facts', () => {
    expect(makePlacedTargets({ catalog: testCatalog, lastCentreNear, site: () => phoenix, settings }).facts('23h18m56s +61d33m37s', orionOverhead)).toMatchObject({ type: 'J2000 position', otherNames: [], sizeArcminutes: null, dualBandHint: false })
  })

  it('gives the last centre reached near a target and how far east and north of the target it lies', () => {
    const placed = makePlacedTargets({ catalog: testCatalog, lastCentreNear, site: () => undefined, settings })

    const centre = placed.facts('orion', orionOverhead)?.lastCentre

    expect(centre).toMatchObject(bubbleFraming)
    expect(centre?.eastDegrees).toBeCloseTo(0.08 * Math.cos((5.39 * Math.PI) / 180), 6)
    expect(centre?.northDegrees).toBeCloseTo(0.19, 6)
    expect(placed.facts('andromeda', orionOverhead)?.lastCentre).toBeNull()
  })

  it('offers no earlier centre for typed coordinates, which are their own centre', () => {
    const placed = makePlacedTargets({ catalog: testCatalog, lastCentreNear: () => bubbleFraming, site: () => undefined, settings })

    expect(placed.facts('05h35m17s -05d23m28s', orionOverhead)?.lastCentre).toBeNull()
    expect(placed.facts('orion', orionOverhead)?.lastCentre).not.toBeNull()
  })

  it('lists what will be best placed when it gets dark, when asked in daylight', () => {
    const placed = makePlacedTargets({ catalog: testCatalog, lastCentreNear, site: () => phoenix, settings })
    const noon = Date.UTC(2026, 10, 15, 19, 0)
    const dark = skyTonight(phoenix, noon).dark

    expect(dark).not.toBeNull()
    expect(placed.bestPlaced(noon, everything)).toEqual(placed.bestPlaced(dark?.from ?? noon, everything))
    expect(placed.bestPlaced(noon, everything)).not.toEqual([])
  })
})
