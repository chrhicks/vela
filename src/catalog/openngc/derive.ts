import { Effect } from 'effect'
import { angularDistance } from '../../sky/coordinates.ts'
import { SourceUnreadable } from '../sources.ts'
import type { StellariumObject } from '../stellarium/objects.ts'
import type { OpenNgcObject } from './objects.ts'
import { objectsFile, openNgc } from './source.ts'

export type Placed = {
  readonly name: string
  readonly raDegrees: number
  readonly decDegrees: number
  readonly stellariumDso: number | null
}

export type OtherName = {
  readonly name: string
  readonly alias: string
  readonly common: 0 | 1
  readonly place: number
}

const leftOut: ReadonlySet<string> = new Set(['Dup', 'NonEx'])
const cellsPerDegree = 4
const arcsecondsPerDegree = 3600

const sexagesimal = /^([+-]?)(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)$/

function degreesOf(text: string, perUnit: number) {
  const parts = sexagesimal.exec(text)

  if (parts === null) return undefined

  const size = (Number(parts[2]) + Number(parts[3]) / 60 + Number(parts[4]) / 3600) * perUnit

  return parts[1] === '-' ? -size : size
}

const plainNumber = /^(NGC|IC)0*(\d+)$/
const numbered = /^(NGC|IC|M|B|C|H|Mel|HCG|UGC|PGC|ESO|Cl|MWSC)0*(\d.*)$/

export const designationOf = (name: string) => {
  const parts = numbered.exec(name)

  return parts === null ? name : `${parts[1]} ${parts[2]}`
}

const listed = (text: string | null) => (text === null ? [] : text.split(',').map(part => part.trim()).filter(part => part !== ''))

const numberedAs = (prefix: string, text: string | null) => listed(text).map(number => `${prefix} ${number.replace(/^0+(?=\d)/, '')}`)

export function namesOf(object: OpenNgcObject): ReadonlyArray<OtherName> {
  const designations = [...numberedAs('M', object.m), designationOf(object.name), ...numberedAs('NGC', object.ngc), ...numberedAs('IC', object.ic)]
  const common = listed(object.commonNames)

  return [
    ...[...new Set(designations)].map((alias, place): OtherName => ({ name: object.name, alias, common: 0, place })),
    ...common.map((alias, place): OtherName => ({ name: object.name, alias, common: 1, place: designations.length + place })),
  ]
}

function stellariumFinder(objects: ReadonlyArray<StellariumObject>, withinArcseconds: number) {
  const numbersOf = (column: 'ngc' | 'ic') => new Map(objects.flatMap((object): ReadonlyArray<readonly [number, number]> => (object[column] === null || object[column] === 0 ? [] : [[object[column], object.dso]])))
  const byNgc = numbersOf('ngc')
  const byIc = numbersOf('ic')
  const cells = new Map<string, Array<StellariumObject>>()
  const cellOf = (raDegrees: number, decDegrees: number): readonly [number, number] => [Math.floor(raDegrees * cellsPerDegree), Math.floor(decDegrees * cellsPerDegree)]

  for (const object of objects) {
    const key = cellOf(object.ra, object.dec).join(' ')

    cells.set(key, [...(cells.get(key) ?? []), object])
  }

  return (name: string, raDegrees: number, decDegrees: number): number | null => {
    const number = plainNumber.exec(name)
    const byNumber = number === null ? undefined : (number[1] === 'NGC' ? byNgc : byIc).get(Number(number[2]))

    if (byNumber !== undefined) return byNumber

    const [column, row] = cellOf(raDegrees, decDegrees)
    const near = [-1, 0, 1].flatMap(across => [-1, 0, 1].flatMap(up => cells.get(`${column + across} ${row + up}`) ?? []))
    const nearest = near
      .map(object => ({ dso: object.dso, arcseconds: angularDistance({ raDegrees, decDegrees }, { raDegrees: object.ra, decDegrees: object.dec }) * arcsecondsPerDegree }))
      .sort((a, b) => a.arcseconds - b.arcseconds)[0]

    return nearest !== undefined && nearest.arcseconds <= withinArcseconds ? nearest.dso : null
  }
}

export const placeObjects = (objects: ReadonlyArray<OpenNgcObject>, stellarium: ReadonlyArray<StellariumObject>, sameObjectArcseconds: number) => {
  const find = stellariumFinder(stellarium, sameObjectArcseconds)

  return Effect.forEach(
    objects.flatMap((object, index) => (leftOut.has(object.type) || object.ra === null || object.dec === null ? [] : [{ object, ra: object.ra, dec: object.dec, line: index + 2 }])),
    ({ object, ra, dec, line }) => {
      const raDegrees = degreesOf(ra, 15)
      const decDegrees = degreesOf(dec, 1)

      if (raDegrees === undefined || decDegrees === undefined) return Effect.fail(new SourceUnreadable({ source: openNgc.id, file: objectsFile.name, line, reason: `not a position: ${ra} ${dec}` }))

      return Effect.succeed<Placed>({ name: object.name, raDegrees, decDegrees, stellariumDso: find(object.name, raDegrees, decDegrees) })
    },
  )
}
