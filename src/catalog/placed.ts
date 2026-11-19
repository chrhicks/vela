import type { Site } from '../pointing/target.ts'
import type { EquatorialPosition } from '../sky/coordinates.ts'
import { moonPosition, placementOf } from '../sky/placement.ts'
import { skyTonight } from '../sky/tonight.ts'
import type { CoolerAtStart } from '../../state/remembered.ts'
import type { BestPlacedAsked, SizeArcminutes, TargetFacts, TargetFound } from '../../state/targets.ts'
import { summarised, type Catalog } from './catalog.ts'
import { dualBandHint } from './dual-band.ts'
import { positionTarget } from './position.ts'
import type { CatalogTarget } from './types.ts'

export interface PlacedSettings {
  readonly searchResults: number
  readonly upLineDegrees: number
  readonly bestPlacedRows: number
  readonly bestPlacedMinArcminutes: number
}

export interface PlacedOptions {
  readonly catalog: Catalog
  readonly site: () => Site | undefined
  readonly lastCentreNear: (position: EquatorialPosition) => (EquatorialPosition & { readonly at: number }) | undefined
  readonly lastCoolerFor: (id: string) => CoolerAtStart | undefined
  readonly settings: PlacedSettings
}

const longSideOf = (target: CatalogTarget) => target.majorAxisArcminutes ?? 0

const sizeOf = (target: CatalogTarget): SizeArcminutes => (target.majorAxisArcminutes === null ? null : { long: target.majorAxisArcminutes, short: target.minorAxisArcminutes })

const signedDegrees = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180

const offsetFrom = (target: EquatorialPosition, centre: EquatorialPosition) => ({
  eastDegrees: signedDegrees(centre.raDegrees - target.raDegrees) * Math.cos((target.decDegrees * Math.PI) / 180),
  northDegrees: centre.decDegrees - target.decDegrees,
})

export function makePlacedTargets({ catalog, site, lastCentreNear, lastCoolerFor, settings }: PlacedOptions) {
  const placer = (at: number) => {
    const here = site()

    if (here === undefined) return undefined

    const moon = moonPosition(here, at)

    return (target: CatalogTarget) => placementOf(target, here, at, settings.upLineDegrees, moon)
  }

  return {
    search: (text: string, at: number): ReadonlyArray<TargetFound> => {
      const place = placer(at)

      return catalog.search(text, settings.searchResults).flatMap(found => {
        const target = catalog.find(found.id)

        return target === undefined ? [] : [{ ...found, placement: place?.(target) ?? null, dualBandHint: dualBandHint(target), sizeArcminutes: sizeOf(target) }]
      })
    },

    facts: (id: string, at: number): TargetFacts | undefined => {
      const target = catalog.find(id)

      if (target === undefined) return undefined

      const summary = summarised(target)
      const centred = positionTarget(id) === undefined ? lastCentreNear(target) : undefined
      const shown = [target.name, target.commonName]

      return {
        ...summary,
        raDegrees: target.raDegrees,
        decDegrees: target.decDegrees,
        placement: placer(at)?.(target) ?? null,
        dualBandHint: dualBandHint(target),
        otherNames: catalog.namesOf(target).filter(name => !shown.includes(name)),
        sizeArcminutes: sizeOf(target),
        lastCentre: centred === undefined ? null : { raDegrees: centred.raDegrees, decDegrees: centred.decDegrees, at: centred.at, ...offsetFrom(target, centred) },
        lastCooler: lastCoolerFor(id) ?? null,
      }
    },

    bestPlaced: (asked: number, { show, order }: BestPlacedAsked): ReadonlyArray<TargetFound> => {
      const here = site()
      const dark = here === undefined ? null : skyTonight(here, asked).dark
      const place = placer(dark !== null && asked < dark.from ? dark.from : asked)

      if (place === undefined) return []

      const listed = catalog.mostCited.filter(target => target.commonName !== null && longSideOf(target) >= settings.bestPlacedMinArcminutes && (show === 'all' || dualBandHint(target)))
      const ordered = order === 'largest' ? [...listed].sort((a, b) => longSideOf(b) - longSideOf(a)) : listed

      return ordered
        .map(target => ({ target, placement: place(target) }))
        .filter(({ placement }) => placement.line.above === 'until' || placement.line.above === 'always')
        .slice(0, settings.bestPlacedRows)
        .map(({ target, placement }) => ({ ...summarised(target), placement, dualBandHint: dualBandHint(target), sizeArcminutes: sizeOf(target) }))
    },
  }
}
