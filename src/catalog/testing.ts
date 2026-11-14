import { TargetId } from '../../state/targets.ts'
import { catalogOf } from './catalog.ts'
import type { CatalogTarget, TargetName } from './types.ts'

const target = (id: string, name: string, commonName: string | null, type: string, raDegrees: number, decDegrees: number, known: { readonly arcminutes?: number; readonly citations?: number; readonly hydrogen?: boolean } = {}): CatalogTarget => ({
  id: TargetId.make(id),
  name,
  commonName,
  type,
  raDegrees,
  decDegrees,
  majorAxisArcminutes: known.arcminutes ?? null,
  minorAxisArcminutes: null,
  nameCitations: known.citations ?? 0,
  inHydrogenRegionCatalog: known.hydrogen === true ? 1 : 0,
})

export const andromeda = target('andromeda', 'M 31', 'Andromeda Galaxy', 'Gx', 10.68, 41.27, { arcminutes: 189, citations: 24 })

const faintGalaxies = Array.from({ length: 12 }, (_, index) => target(`faint-${index + 1}`, `NGC ${index + 1}`, null, 'G', index, index))

export const testTargets: ReadonlyArray<CatalogTarget> = [
  andromeda,
  target('m3', 'M 3', null, 'GC', 205.55, 28.38),
  target('triangulum', 'M 33', 'Triangulum Galaxy', 'Gx', 23.46, 30.66, { arcminutes: 69, citations: 9 }),
  target('pinwheel', 'M 101', 'Pinwheel Galaxy', 'Gx', 210.8, 54.35, { arcminutes: 29, citations: 7 }),
  target('horsehead', 'B 33', 'Horsehead Nebula', 'DN', 85.25, -2.46, { arcminutes: 4, citations: 12 }),
  target('orion', 'M 42', 'Orion Nebula', 'HII', 83.82, -5.39, { arcminutes: 90, citations: 27, hydrogen: true }),
  target('soul', 'IC 1848', 'Soul Nebula', 'OC', 42.78, 60.41, { arcminutes: 40, citations: 3, hydrogen: true }),
  target('camelopardalis', 'IC 342', null, 'Gx', 56.7, 68.1),
  ...faintGalaxies,
]

export const testNames: ReadonlyArray<TargetName> = [
  ...testTargets.map(({ id, name }) => ({ target: id, name })),
  ...testTargets.flatMap(({ id, commonName }) => (commonName === null ? [] : [{ target: id, name: commonName }])),
  { target: TargetId.make('andromeda'), name: 'NGC 224' },
  { target: TargetId.make('triangulum'), name: 'Pinwheel Galaxy' },
  { target: TargetId.make('orion'), name: 'Great Orion Nebula' },
]

export const testCatalog = catalogOf(testTargets, testNames)
