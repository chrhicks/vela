import type { Site } from '../pointing/target.ts'
import type { EquatorialPosition } from '../sky/coordinates.ts'
import { moonPosition, placementOf } from '../sky/placement.ts'
import { skyTonight } from '../sky/tonight.ts'
import type { TargetFacts, TargetFound } from '../../state/targets.ts'
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
  readonly settings: PlacedSettings
}

const signedDegrees = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180

const offsetFrom = (target: EquatorialPosition, centre: EquatorialPosition) => ({
  eastDegrees: signedDegrees(centre.raDegrees - target.raDegrees) * Math.cos((target.decDegrees * Math.PI) / 180),
  northDegrees: centre.decDegrees - target.decDegrees,
})

export function makePlacedTargets({ catalog, site, lastCentreNear, settings }: PlacedOptions) {
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

        return target === undefined ? [] : [{ ...found, placement: place?.(target) ?? null, dualBandHint: dualBandHint(target) }]
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
        sizeArcminutes: target.majorAxisArcminutes === null ? null : { long: target.majorAxisArcminutes, short: target.minorAxisArcminutes },
        lastCentre: centred === undefined ? null : { raDegrees: centred.raDegrees, decDegrees: centred.decDegrees, at: centred.at, ...offsetFrom(target, centred) },
      }
    },

    bestPlaced: (asked: number): ReadonlyArray<TargetFound> => {
      const here = site()
      const dark = here === undefined ? null : skyTonight(here, asked).dark
      const place = placer(dark !== null && asked < dark.from ? dark.from : asked)

      if (place === undefined) return []

      return catalog.mostCited
        .filter(target => target.commonName !== null && (target.majorAxisArcminutes ?? 0) >= settings.bestPlacedMinArcminutes)
        .map(target => ({ target, placement: place(target) }))
        .filter(({ placement }) => placement.line.above !== 'no')
        .slice(0, settings.bestPlacedRows)
        .map(({ target, placement }) => ({ ...summarised(target), placement, dualBandHint: dualBandHint(target) }))
    },
  }
}
