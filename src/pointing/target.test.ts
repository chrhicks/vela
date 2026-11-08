import { SiderealTime } from 'astronomy-engine'
import { describe, expect, it } from 'vitest'
import type { CatalogRow } from '../catalog/types.ts'
import { makePicture } from '../rig/picture.ts'
import { connected, phoenixLongitude, startedAt, wire } from '../testing/entries.ts'
import { meridianLimitAt, siteOf, targetOf } from './target.ts'

const phoenix = { latitudeDegrees: 33.45, longitudeDegrees: -112.07, elevationMeters: 331 }

const madeUp = (raDegrees: number, decDegrees: number): CatalogRow => ['made-up', 'X 1', null, ['X 1'], raDegrees, decDegrees, 'Galaxy', null, null, null]

const arcseconds = (degrees: number) => degrees * 3600

describe('epoch of date', () => {
  it('moves the J2000 origin by the precession of 26.85 years, to within the nutation and aberration', () => {
    const at = Date.UTC(2026, 10, 8, 3, 0, 0)
    const target = targetOf(madeUp(0, 0), phoenix, at)
    const precessionRaArcseconds = 46.124 * 26.85
    const precessionDecArcseconds = 20.043 * 26.85
    const nutationAndAberrationArcseconds = 60

    expect(Math.abs(arcseconds(target.raHours * 15) - precessionRaArcseconds)).toBeLessThan(nutationAndAberrationArcseconds)
    expect(Math.abs(arcseconds(target.decDegrees) - precessionDecArcseconds)).toBeLessThan(nutationAndAberrationArcseconds)
  })

  it('keeps the J2000 position beside the one of date, and the catalog names', () => {
    const target = targetOf(madeUp(90, 45), phoenix, startedAt)

    expect(target).toMatchObject({ id: 'made-up', name: 'X 1', commonName: null, type: 'Galaxy', raJ2000Hours: 6, decJ2000Degrees: 45 })
    expect(target.raHours).not.toBe(6)
  })

  it('gives right ascension in hours inside 0 to 24', () => {
    const near = targetOf(madeUp(359.99, 10), phoenix, startedAt)

    expect(near.raHours).toBeGreaterThanOrEqual(0)
    expect(near.raHours).toBeLessThan(24)
  })
})

function mountPicture(options: { site?: boolean; limit?: boolean } = {}) {
  const picture = makePicture()

  picture.apply(connected(startedAt), startedAt)

  if (options.site !== false) picture.apply(wire(startedAt, 'def', 'mount', 'GEOGRAPHIC_COORD', { LAT: 33.45, LONG: phoenixLongitude, ELEV: 331 }, 'Ok'), startedAt)
  if (options.limit !== false) picture.apply(wire(startedAt, 'def', 'mount', 'MERIDIAN_LIMIT', { LIMIT: 5 }, 'Ok'), startedAt)

  return picture
}

describe('the site and the meridian limit', () => {
  it('reads the site from the mount and turns the INDI longitude into east positive degrees', () => {
    expect(siteOf(mountPicture(), 'mount')).toEqual({ latitudeDegrees: 33.45, longitudeDegrees: phoenixLongitude - 360, elevationMeters: 331 })
  })

  it('knows no site until the mount reports one', () => {
    expect(siteOf(mountPicture({ site: false }), 'mount')).toBeUndefined()
  })

  it('says when a position reaches the limit, or nothing without the site or the limit', () => {
    const at = startedAt + 60_000
    const picture = mountPicture()
    const oneHourEast = (((SiderealTime(new Date(at)) + phoenixLongitude / 15 + 1) % 24) + 24) % 24
    const minutesLeft = ((meridianLimitAt(picture, 'mount', oneHourEast, at) ?? 0) - at) / 60_000

    expect(minutesLeft).toBeCloseTo(80 / 1.0027379093, 1)
    expect(meridianLimitAt(mountPicture({ site: false }), 'mount', 5.5, at)).toBeUndefined()
    expect(meridianLimitAt(mountPicture({ limit: false }), 'mount', 5.5, at)).toBeUndefined()
  })
})
