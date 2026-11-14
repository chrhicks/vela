import type { Site } from '../pointing/target.ts'
import { moonPosition, placementOf } from '../sky/placement.ts'
import type { TargetFound } from '../../state/targets.ts'
import { summarised, type Catalog } from './catalog.ts'
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
  readonly settings: PlacedSettings
}

export function makePlacedTargets({ catalog, site, settings }: PlacedOptions) {
  const placer = (at: number) => {
    const here = site()

    if (here === undefined) return undefined

    const moon = moonPosition(here, at)

    return (target: CatalogTarget) => placementOf(target, here, at, settings.upLineDegrees, moon)
  }

  return {
    search: (text: string, at: number): ReadonlyArray<TargetFound> => {
      const place = placer(at)

      return catalog.search(text, settings.searchResults).map(found => {
        const target = catalog.find(found.id)

        return { ...found, placement: place === undefined || target === undefined ? null : place(target) }
      })
    },

    bestPlaced: (at: number): ReadonlyArray<TargetFound> => {
      const place = placer(at)

      if (place === undefined) return []

      return catalog.mostCited
        .filter(target => target.commonName !== null && (target.majorAxisArcminutes ?? 0) >= settings.bestPlacedMinArcminutes)
        .map(target => ({ target, placement: place(target) }))
        .filter(({ placement }) => placement.line.above !== 'no')
        .slice(0, settings.bestPlacedRows)
        .map(({ target, placement }) => ({ ...summarised(target), placement }))
    },
  }
}
