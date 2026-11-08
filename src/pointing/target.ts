import { toMount } from '../sky/coordinates.ts'
import type { CatalogRow } from '../catalog/types.ts'
import type { Picture } from '../rig/picture.ts'
import { secondsToMeridianLimit } from '../sky/meridian.ts'

export interface Target {
  readonly id: string
  readonly name: string
  readonly commonName: string | null
  readonly type: string
  readonly constellation: string | null
  readonly raJ2000Hours: number
  readonly decJ2000Degrees: number
  readonly raHours: number
  readonly decDegrees: number
}

export interface Site {
  latitudeDegrees: number
  longitudeDegrees: number
  elevationMeters: number
}

export function siteOf(picture: Pick<Picture, 'property'>, mount: string): Site | undefined {
  const values = picture.property(mount, 'GEOGRAPHIC_COORD')?.values
  const latitude = values?.['LAT']
  const longitude = values?.['LONG']
  const elevation = values?.['ELEV']

  if (typeof latitude !== 'number' || typeof longitude !== 'number') return undefined

  return { latitudeDegrees: latitude, longitudeDegrees: longitude > 180 ? longitude - 360 : longitude, elevationMeters: typeof elevation === 'number' ? elevation : 0 }
}

export function targetOf(row: CatalogRow, at: number): Target {
  const ofDate = toMount({ raDegrees: row[4], decDegrees: row[5] }, new Date(at))

  return {
    id: row[0],
    name: row[1],
    commonName: row[2],
    type: row[6],
    constellation: row[9],
    raJ2000Hours: row[4] / 15,
    decJ2000Degrees: row[5],
    raHours: ofDate.raDegrees / 15,
    decDegrees: ofDate.decDegrees,
  }
}

export function meridianLimitAt(picture: Pick<Picture, 'property'>, mount: string, raHours: number, at: number) {
  const site = siteOf(picture, mount)
  const limit = picture.property(mount, 'MERIDIAN_LIMIT')?.values['LIMIT']

  if (site === undefined || typeof limit !== 'number') return undefined

  return at + secondsToMeridianLimit({ raHours, longitudeDegrees: site.longitudeDegrees, limitDegrees: limit, at }) * 1000
}
