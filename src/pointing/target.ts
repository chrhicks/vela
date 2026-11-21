import { toMount } from '../sky/coordinates.ts'
import type { CatalogTarget } from '../catalog/types.ts'
import type { Picture } from '../rig/picture.ts'
import { secondsToMeridianLimit } from '../sky/meridian.ts'

export interface Target {
  readonly id: string
  readonly name: string
  readonly commonName: string | null
  readonly type: string
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

export const siteAt = (latitude: number, longitude: number, elevation: number | undefined): Site => ({ latitudeDegrees: latitude, longitudeDegrees: longitude > 180 ? longitude - 360 : longitude, elevationMeters: elevation ?? 0 })

export function siteOf(picture: Pick<Picture, 'property'>, mount: string): Site | undefined {
  const values = picture.property(mount, 'GEOGRAPHIC_COORD')?.values
  const latitude = values?.['LAT']
  const longitude = values?.['LONG']
  const elevation = values?.['ELEV']

  if (typeof latitude !== 'number' || typeof longitude !== 'number') return undefined

  return siteAt(latitude, longitude, typeof elevation === 'number' ? elevation : undefined)
}

export function targetOf(found: CatalogTarget, at: number): Target {
  const ofDate = toMount(found, new Date(at))

  return {
    id: found.id,
    name: found.name,
    commonName: found.commonName,
    type: found.type,
    raJ2000Hours: found.raDegrees / 15,
    decJ2000Degrees: found.decDegrees,
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
