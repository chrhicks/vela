import { catalogOf } from './catalog.ts'
import type { CatalogTarget, TargetName } from './types.ts'

const target = (id: string, name: string, commonName: string | null, type: string, raDegrees: number, decDegrees: number): CatalogTarget => ({ id, name, commonName, type, raDegrees, decDegrees, majorAxisArcminutes: null, minorAxisArcminutes: null })

export const andromeda = target('andromeda', 'M 31', 'Andromeda Galaxy', 'Gx', 10.68, 41.27)

const faintGalaxies = Array.from({ length: 12 }, (_, index) => target(`faint-${index + 1}`, `NGC ${index + 1}`, null, 'G', index, index))

export const testTargets: ReadonlyArray<CatalogTarget> = [
  andromeda,
  target('m3', 'M 3', null, 'GC', 205.55, 28.38),
  target('triangulum', 'M 33', 'Triangulum Galaxy', 'Gx', 23.46, 30.66),
  target('pinwheel', 'M 101', 'Pinwheel Galaxy', 'Gx', 210.8, 54.35),
  target('horsehead', 'B 33', 'Horsehead Nebula', 'DN', 85.25, -2.46),
  target('orion', 'M 42', 'Orion Nebula', 'HII', 83.82, -5.39),
  ...faintGalaxies,
]

export const testNames: ReadonlyArray<TargetName> = [
  ...testTargets.map(({ id, name }) => ({ target: id, name })),
  ...testTargets.flatMap(({ id, commonName }) => (commonName === null ? [] : [{ target: id, name: commonName }])),
  { target: 'andromeda', name: 'NGC 224' },
  { target: 'triangulum', name: 'Pinwheel Galaxy' },
  { target: 'orion', name: 'Great Orion Nebula' },
]

export const testCatalog = catalogOf(testTargets, testNames)
