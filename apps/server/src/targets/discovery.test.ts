import { describe, expect, it } from 'vitest'
import { Horizon, Observer, SiderealTime } from 'astronomy-engine'
import { getTarget, listTargets, type CatalogTarget } from './catalog/index.js'
import { discoverTargets } from './discovery.js'
import { fromMount, toMount } from './sky.js'

const site = { latitudeDegrees: 40, longitudeDegrees: -75, elevationMeters: 0 }
const now = new Date('2026-09-07T04:00:00Z')
const target = (id: string, overrides: Partial<CatalogTarget> = {}): CatalogTarget => ({
  id, catalogName: id, commonName: null, aliases: [id], raDegrees: 10.68470833,
  decDegrees: 41.26875, type: 'Galaxy', majorAxisArcminutes: 100, minorAxisArcminutes: null, ...overrides,
})
function preciseAltitude(record: CatalogTarget, at: string, location = site) {
  const date = new Date(at)
  const position = toMount(record, 'topocentric', date, location)
  return Horizon(date, new Observer(location.latitudeDegrees, location.longitudeDegrees, 0), position.raDegrees / 15, position.decDegrees).altitude
}

describe('target discovery', () => {
  it('starts an active night now and keeps every opportunity and peak in the future dark interval', () => {
    const result = discoverTargets({ targets: listTargets(), site, now })
    expect(result.status).toBe('available')
    expect(result.window?.kind).toBe('current-night')
    expect(result.window?.startsAt).toBe(now.toISOString())
    expect(result.candidates).toHaveLength(13_372)
    expect(new Set(result.candidates.map(candidate => candidate.target.id)).size).toBe(13_372)
    let ineligible = false
    for (const candidate of result.candidates) {
      expect(Number.isFinite(candidate.score)).toBe(true)
      const opportunity = candidate.opportunity
      if (!opportunity) { ineligible = true; expect(candidate.eligible).toBe(false); continue }
      expect(ineligible).toBe(false)
      expect(Date.parse(opportunity.startsAt)).toBeGreaterThanOrEqual(now.getTime())
      expect(Date.parse(opportunity.endsAt)).toBeLessThanOrEqual(Date.parse(result.window!.endsAt))
      expect(Date.parse(opportunity.bestAt)).toBeGreaterThanOrEqual(Date.parse(opportunity.startsAt))
      expect(Date.parse(opportunity.bestAt)).toBeLessThanOrEqual(Date.parse(opportunity.endsAt))
      expect(opportunity.usefulMinutes).toBeGreaterThan(0)
      expect(opportunity.usefulMinutes).toBeCloseTo((Date.parse(opportunity.endsAt) - Date.parse(opportunity.startsAt)) / 60_000, 4)
      expect(opportunity.bestAltitudeDegrees).toBeGreaterThanOrEqual(30 - 1e-8)
      expect(Number.isFinite(opportunity.currentAltitudeDegrees)).toBe(true)
    }
    const m31 = result.candidates.find(candidate => candidate.target.id === 'ngc0224')!
    // Independent ERFA/SOFA apparent altitude benchmark documented in sky.test.ts.
    expect(Math.abs(m31.opportunity!.currentAltitudeDegrees - 60.06028088597603)).toBeLessThan(0.02)
  })

  it('finds the upcoming night during daylight, including targets below the horizon now', () => {
    const date = new Date('2026-09-07T17:00:00Z')
    const result = discoverTargets({ targets: listTargets(), site, now: date })
    expect(result.window?.kind).toBe('upcoming-night')
    expect(Date.parse(result.window!.startsAt)).toBeGreaterThan(date.getTime())
    expect(result.candidates.some(candidate => candidate.eligible && candidate.opportunity!.currentAltitudeDegrees < 0)).toBe(true)
  })

  it('matches precise altitude at useful interval edges and maxima across RA wrap and circumpolar targets', () => {
    const targets = [target('m31'), target('wrap', { raDegrees: 359.99, decDegrees: 10 }), target('pole', { raDegrees: 0.01, decDegrees: 89.99 }), target('vega', { raDegrees: 279.2347, decDegrees: 38.7837 })]
    const result = discoverTargets({ targets, site, now })
    for (const candidate of result.candidates) {
      const opportunity = candidate.opportunity!
      expect(opportunity).not.toBeNull()
      expect(Math.abs(preciseAltitude(candidate.target, opportunity.bestAt) - opportunity.bestAltitudeDegrees)).toBeLessThan(0.02)
      for (const at of [opportunity.startsAt, opportunity.endsAt]) {
        expect(preciseAltitude(candidate.target, at)).toBeGreaterThan(29.98)
        if (at !== result.window!.startsAt && at !== result.window!.endsAt) expect(preciseAltitude(candidate.target, at)).toBeCloseTo(30, 1)
      }
    }
  })

  it('finds a brief grazing transit between samples and excludes a target that never reaches 30 degrees', () => {
    const peak = new Date('2026-09-07T04:07:30Z')
    const raDegrees = (SiderealTime(peak) * 15 + site.longitudeDegrees + 360) % 360
    const grazer = target('grazer', fromMount({ raDegrees, decDegrees: -19.99 }, 'topocentric', peak, site))
    const hidden = target('hidden', { decDegrees: -80 })
    const result = discoverTargets({ targets: [grazer, hidden], site, now })
    const opportunity = result.candidates[0]!.opportunity!
    expect(opportunity).not.toBeNull()
    expect(opportunity.usefulMinutes).toBeLessThan(15)
    expect(opportunity.usefulMinutes).toBeGreaterThan(1)
    expect(result.candidates[1]!.eligible).toBe(false)
  })

  it.each([90, -90])('handles continuous darkness and finite altitudes at latitude %s', latitudeDegrees => {
    const location = { ...site, latitudeDegrees }
    const date = new Date(latitudeDegrees > 0 ? '2026-12-21T00:00:00Z' : '2026-06-21T00:00:00Z')
    const result = discoverTargets({ targets: [target('polar', { decDegrees: latitudeDegrees > 0 ? 60 : -60 })], site: location, now: date })
    expect(result.window?.kind).toBe('polar-night')
    const opportunity = result.candidates[0]!.opportunity!
    expect(opportunity.usefulMinutes).toBeCloseTo(1440, 6)
    expect(Number.isFinite(opportunity.bestAltitudeDegrees)).toBe(true)
    expect(Number.isFinite(opportunity.currentAltitudeDegrees)).toBe(true)
  })

  it('retains the searchable catalog without false recommendations when site or darkness is unavailable', () => {
    const targets = [target('b'), target('a')]
    for (const location of [null, { ...site, latitudeDegrees: NaN }, { ...site, longitudeDegrees: 181 }]) {
      const result = discoverTargets({ targets, site: location, now })
      expect(result.status).toBe('site-unavailable')
      expect(result.window).toBeNull()
      expect(result.candidates.map(candidate => candidate.target.id)).toEqual(['a', 'b'])
      expect(result.candidates.every(candidate => !candidate.eligible && candidate.opportunity === null)).toBe(true)
    }
    const polarDay = discoverTargets({ targets, site: { ...site, latitudeDegrees: 90 }, now: new Date('2026-06-21T00:00:00Z') })
    expect(polarDay.status).toBe('no-darkness')
    expect(polarDay.candidates.every(candidate => !candidate.eligible)).toBe(true)
    expect(() => discoverTargets({ targets, site, now: new Date('invalid') })).toThrow(RangeError)
  })

  it('distinguishes emission lines, continuum and uncertain mixed labels without inventing angular sizes', () => {
    const records = ['ic1396', 'ic1805', 'ic1848', 'ngc1432', 'ngc1435', 'ngc7023', 'ngc0224', 'ngc6720'].map(id => getTarget(id)!)
    const uncertain = target('mixed', { type: 'Star cluster and nebula', majorAxisArcminutes: null })
    const result = discoverTargets({ targets: [...records, uncertain], site: null, now })
    for (const candidate of result.candidates) {
      expect(candidate.filter).toBe(candidate.target.id === 'mixed' ? 'uncertain' : ['ngc1432', 'ngc1435', 'ngc7023', 'ngc0224'].includes(candidate.target.id) ? 'broadband' : 'dual-band')
    }
    expect(result.candidates.find(candidate => candidate.target.id === 'mixed')!.target).toBe(uncertain)
    expect(uncertain.majorAxisArcminutes).toBeNull()
  })

  it('ranks a long opportunity above a showpiece that is almost set', () => {
    const lst = (SiderealTime(now) * 15 + site.longitudeDegrees + 360) % 360
    // At latitude 40, declination 0 reaches altitude 30 at hour angle ~49.25°.
    const setting = target('ngc1976', {
      ...fromMount({ raDegrees: (lst - 49 + 360) % 360, decDegrees: 0 }, 'topocentric', now, site),
      type: 'Nebula', majorAxisArcminutes: 120,
    })
    const sustained = target('ordinary', { ...fromMount({ raDegrees: lst, decDegrees: 40 }, 'topocentric', now, site) })
    const result = discoverTargets({ targets: [setting, sustained], site, now })
    expect(result.candidates.map(candidate => candidate.target.id)).toEqual(['ordinary', 'ngc1976'])
    expect(result.candidates[1]!.opportunity!.usefulMinutes).toBeLessThan(2)
    const later = discoverTargets({ targets: [setting], site, now: new Date(now.getTime() + 300_000) })
    expect(later.candidates[0]!.eligible).toBe(false)
  })

  it('rewards sustained showpiece opportunities while keeping deterministic ties and caller order untouched', () => {
    const records = Object.freeze([target('z'), target('a'), target('ngc1976', { type: 'Nebula' })])
    const input = { targets: records, site, now }
    const first = discoverTargets(input)
    expect(first.candidates[0]!.target.id).toBe('ngc1976')
    expect(first.candidates.slice(1).map(candidate => candidate.target.id)).toEqual(['a', 'z'])
    expect(discoverTargets(input)).toEqual(first)
    expect(records.map(record => record.id)).toEqual(['z', 'a', 'ngc1976'])
  })
})
