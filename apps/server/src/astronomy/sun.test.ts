import { describe, expect, it } from 'vitest'
import { astronomicalDarkDegrees, darkOutlook, sunAltitudeDegrees } from './sun.js'

const greenwich = { latitudeDegrees: 51.4769, longitudeDegrees: -0.0005 }

const at = (iso: string) => new Date(iso)

describe('sunAltitudeDegrees', () => {
  // Altitude at a culmination is 90 - latitude + declination, with declination +-23.44 at a solstice.
  it('is about 62 degrees at Greenwich noon on the June solstice and 15 at the December one', () => {
    expect(sunAltitudeDegrees(greenwich, at('2026-06-21T12:02:00Z'))).toBeCloseTo(61.96, 0)
    expect(sunAltitudeDegrees(greenwich, at('2026-12-21T11:58:00Z'))).toBeCloseTo(15.08, 0)
  })

  it('is about -62 degrees at the December solstice midnight and -15 at the June one', () => {
    expect(sunAltitudeDegrees(greenwich, at('2026-12-21T23:58:00Z'))).toBeCloseTo(-61.96, 0)
    expect(sunAltitudeDegrees(greenwich, at('2026-06-21T00:02:00Z'))).toBeCloseTo(-15.08, 0)
  })

  it('follows longitude: at 06:00 UTC on the equinox the sun is rising at 0 E and overhead at 90 E', () => {
    const instant = at('2026-03-20T06:00:00Z')

    expect(sunAltitudeDegrees({ latitudeDegrees: 0, longitudeDegrees: 0 }, instant)).toBeCloseTo(0, -1)
    expect(sunAltitudeDegrees({ latitudeDegrees: 0, longitudeDegrees: 90 }, instant)).toBeGreaterThan(85)
  })
})

describe('darkOutlook', () => {
  it('is dark at midnight in October and says when it ends', () => {
    const outlook = darkOutlook(greenwich, at('2026-10-24T23:00:00Z'))

    expect(outlook.dark).toBe(true)
    expect(outlook.dark && outlook.until?.toISOString()).toMatch(/^2026-10-25T0[4-5]:/)
  })

  it('is not dark at noon, and gives the coming dusk and the dawn after it', () => {
    const outlook = darkOutlook(greenwich, at('2026-10-25T12:00:00Z'))

    expect(outlook.dark).toBe(false)

    if (outlook.dark) return

    expect(outlook.from?.toISOString()).toMatch(/^2026-10-25T1[7-8]:/)
    expect(outlook.until?.toISOString()).toMatch(/^2026-10-26T0[4-5]:/)
  })

  it('puts the sun at the dark limit exactly when it says darkness starts and ends', () => {
    const outlook = darkOutlook(greenwich, at('2026-10-25T12:00:00Z'))

    if (outlook.dark || !outlook.from || !outlook.until) throw new Error('expected a dusk and a dawn')

    expect(sunAltitudeDegrees(greenwich, outlook.from)).toBeCloseTo(astronomicalDarkDegrees, 1)
    expect(sunAltitudeDegrees(greenwich, outlook.until)).toBeCloseTo(astronomicalDarkDegrees, 1)
    expect(sunAltitudeDegrees(greenwich, new Date(outlook.from.getTime() + 60_000))).toBeLessThan(astronomicalDarkDegrees)
    expect(sunAltitudeDegrees(greenwich, new Date(outlook.from.getTime() - 60_000))).toBeGreaterThan(astronomicalDarkDegrees)
  })

  it('is not dark at midnight at Greenwich in midsummer, when the sun stays within 18 degrees', () => {
    expect(darkOutlook(greenwich, at('2026-06-21T00:00:00Z'))).toEqual({ dark: false, from: null, until: null })
  })

  it('stays dark through a polar winter day, when the sun culminates at -18.4 degrees', () => {
    expect(darkOutlook({ latitudeDegrees: 85, longitudeDegrees: 15.6 }, at('2026-12-21T12:00:00Z'))).toEqual({
      dark: true,
      until: null,
    })
  })

  it('works in the southern hemisphere', () => {
    const site = { latitudeDegrees: -33.9, longitudeDegrees: 18.4 }

    expect(darkOutlook(site, at('2026-07-01T22:00:00Z')).dark).toBe(true)
    expect(darkOutlook(site, at('2026-07-01T10:00:00Z')).dark).toBe(false)
  })
})
