import { SiderealTime } from 'astronomy-engine'
import { readFitsCards } from '@vela/rig-astap'
import { syntheticSite } from '@vela/rig-testing'
import { describe, expect, it } from 'vitest'
import { encodeCaptureFits, type FrameSettings } from '../src/imaging/fits.js'

const metadata = { exposureSeconds: 1.5, cameraName: 'Test camera' }

const frame = {
  width: 3,
  height: 2,
  pixels: [-2_147_483_648, -1, 0, 1, 65535, 2_147_483_647],
  capturedAt: '2026-09-05T19:00:00-04:00',
}

describe('where and when a light frame was taken', () => {
  const started = '2026-09-05T23:00:00Z'
  const exposureSeconds = 600
  const midpoint = new Date('2026-09-05T23:05:00Z')
  const lstHours = (at: Date) => (((SiderealTime(at) + syntheticSite.longitudeDegrees / 15) % 24) + 24) % 24

  const mount = {
    rightAscensionDegrees: 300,
    declinationDegrees: 40,
    coordinateSystem: 'j2000' as const,
    tracking: true,
    slewing: false,
    site: syntheticSite,
  }

  const take = async (settings: FrameSettings, extra: Partial<Parameters<typeof encodeCaptureFits>[1]> = {}) =>
    readFitsCards(await encodeCaptureFits({ ...frame, capturedAt: started }, { ...metadata, exposureSeconds, settings, ...extra }))

  const number = (cards: ReadonlyMap<string, string>, key: string) => Number(cards.get(key))

  it('states the exposure midpoint, the site, sidereal time, J2000 pointing and hour angle', async () => {
    const cards = await take({ mount, pierSide: 'west' })
    const lst = lstHours(midpoint)

    expect(cards.get('DATE-OBS')).toBe('2026-09-05T23:00:00.000Z')
    expect(cards.get('DATE-AVG')).toBe('2026-09-05T23:05:00.000Z')
    expect(cards.get('PIERSIDE')).toBe('WEST')
    expect(number(cards, 'SITELAT')).toBe(syntheticSite.latitudeDegrees)
    expect(number(cards, 'SITELONG')).toBe(syntheticSite.longitudeDegrees)
    expect(number(cards, 'SITEELEV')).toBe(syntheticSite.elevationMeters)
    expect(number(cards, 'LST')).toBeCloseTo(lst, 9)
    expect(number(cards, 'RA')).toBe(300)
    expect(number(cards, 'DEC')).toBe(40)
    expect(number(cards, 'HA')).toBeCloseTo(((((lst - 20 + 12) % 24) + 24) % 24) - 12, 1)
  })

  it('takes sidereal time at the midpoint, not at the start', async () => {
    const atStart = lstHours(new Date(started))

    expect(number(await take({ mount }), 'LST') - atStart).toBeCloseTo((300 * 1.0027379093) / 3600, 4)
  })

  it('counts hour angle west of the meridian as positive', async () => {
    const lst = lstHours(midpoint)
    const west = await take({ mount: { ...mount, rightAscensionDegrees: (lst - 2) * 15, coordinateSystem: 'topocentric' } })
    const east = await take({ mount: { ...mount, rightAscensionDegrees: (lst + 2) * 15, coordinateSystem: 'topocentric' } })

    expect(number(west, 'HA')).toBeCloseTo(2, 6)
    expect(number(east, 'HA')).toBeCloseTo(-2, 6)
  })

  it('writes J2000 RA and DEC from a mount that reports of-date coordinates', async () => {
    const cards = await take({ mount: { ...mount, coordinateSystem: 'topocentric' } })

    expect(Math.abs(number(cards, 'RA') - 300)).toBeGreaterThan(0.1)
    expect(Math.abs(number(cards, 'RA') - 300)).toBeLessThan(1)
    expect(Math.abs(number(cards, 'DEC') - 40)).toBeLessThan(1)
  })

  it('saves a frame with no mount reading and no pointing, site or time cards', async () => {
    const cards = await take({ pierSide: 'east' })

    for (const key of ['DATE-AVG', 'SITELAT', 'SITELONG', 'SITEELEV', 'LST', 'RA', 'DEC', 'HA']) expect(cards.has(key)).toBe(false)
    expect(cards.get('PIERSIDE')).toBe('EAST')
    expect(cards.get('NAXIS1')).toBe('3')
  })

  it('keeps the site and sidereal time but states no pointing while the mount slews or does not track', async () => {
    for (const unsettled of [{ slewing: true }, { tracking: false }]) {
      const cards = await take({ mount: { ...mount, ...unsettled } })

      expect(cards.has('LST')).toBe(true)
      expect(cards.has('SITELAT')).toBe(true)

      for (const key of ['RA', 'DEC', 'HA']) expect(cards.has(key)).toBe(false)
    }
  })

  it('leaves out the site cards when the mount gave no site, and the elevation when it gave none', async () => {
    const { site: _site, ...noSite } = mount
    const { elevationMeters: _elevation, ...flat } = syntheticSite
    const bare = await take({ mount: noSite })
    const noElevation = await take({ mount: { ...mount, site: flat } })

    expect([...bare.keys()].filter(key => ['SITELAT', 'LST', 'RA', 'HA'].includes(key))).toEqual([])
    expect(noElevation.has('SITEELEV')).toBe(false)
    expect(noElevation.has('SITELAT')).toBe(true)
  })

  it('leaves out a site or pointing that is not a valid place on the sky', async () => {
    expect((await take({ mount: { ...mount, site: { latitudeDegrees: 91, longitudeDegrees: 0 } } })).has('LST')).toBe(false)
    expect((await take({ mount: { ...mount, rightAscensionDegrees: NaN } })).has('RA')).toBe(false)
    expect((await take({ mount: { ...mount, declinationDegrees: 95 } })).has('DEC')).toBe(false)
  })

  it.each(['dark', 'flat', 'dark-flat', 'bias'] as const)('adds none of them to a %s frame', async frameType => {
    const cards = await take({ mount }, { frameType })

    for (const key of ['DATE-AVG', 'SITELAT', 'LST', 'RA', 'DEC', 'HA']) expect(cards.has(key)).toBe(false)
  })
})
