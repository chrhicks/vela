import {
  Body, Equator, Horizon, MakeTime, Observer, RotateVector, Rotation_EQJ_EQD,
  SearchAltitude, SiderealTime, Vector,
} from 'astronomy-engine'
import type { TargetCategory, TargetFilterChoice, TargetOpportunity } from '@vela/model/web'
import type { CatalogTarget } from './catalog/index.js'
import type { Site } from './sky.js'

export interface DiscoveryInput {
  targets: readonly CatalogTarget[]
  site: Site | null
  now: Date
}

export interface DiscoveryCandidate {
  target: CatalogTarget
  category: TargetCategory
  filter: TargetFilterChoice
  filterReason: 'emission-lines' | 'continuum' | 'mixed-or-unknown'
  eligible: boolean
  opportunity: TargetOpportunity | null
  /** Relative photographic heuristic, not brightness or an image-quality forecast. */
  score: number
}

export interface DiscoveryWindow {
  startsAt: string
  endsAt: string
  /** Polar darkness is bounded to 24 hours, not a prediction of its eventual dawn. */
  kind: 'current-night' | 'upcoming-night' | 'polar-night'
}

export interface TargetDiscovery {
  observedAt: string
  status: 'available' | 'site-unavailable' | 'no-darkness'
  window: DiscoveryWindow | null
  /** All catalog records remain searchable, including ineligible targets. */
  candidates: DiscoveryCandidate[]
}

const radians = Math.PI / 180

const turn = Math.PI * 2

const day = 86_400_000

const minimumAltitude = 30

const clamp = (value: number) => Math.max(-1, Math.min(1, value))

// These refine broad/mixed catalog labels only; positions and extents remain untouched.
// Reflection classifications: https://ntrs.nasa.gov/citations/19820023352
// IC1396: https://science.nasa.gov/photojournal/dark-globule-in-ic-1396-irac/
// California: https://www.spitzer.caltech.edu/image/ssc2020-10a-spitzer-california-nebula-mosaic
// Heart/Soul and Orion/Flame identifications are documented at catalog/README.md.
const categoryOverrides: Readonly<Record<string, TargetCategory>> = {
  ic1396: 'emission', ic1805: 'emission', ic1848: 'emission',
  ngc1499: 'emission', ngc1976: 'emission', ngc2024: 'emission',
  ngc1432: 'reflection-dark', ngc1435: 'reflection-dark', ngc7023: 'reflection-dark',
}

// A small editorial nudge, not a whitelist or a brightness/magnitude surrogate.
const showpieces = new Set([
  'ngc0224', 'ngc0598', 'ngc1976', 'ngc2024', 'ngc1499', 'ngc6205',
  'ngc6720', 'ngc6853', 'ngc6888', 'ngc6960', 'ngc6992', 'ngc7000',
  'ngc7023', 'ngc7293', 'ngc7635', 'ic1396', 'ic1805', 'ic1848',
])

function description(target: CatalogTarget) {
  let category: TargetCategory = categoryOverrides[target.id] ?? 'other'

  if (!categoryOverrides[target.id]) {
    if (['H II region', 'Emission nebula', 'Supernova remnant'].includes(target.type)) category = 'emission'
    else if (['Reflection nebula', 'Dark nebula'].includes(target.type)) category = 'reflection-dark'
    else if (target.type.startsWith('Galaxy')) category = 'galaxy'
    else if (['Open cluster', 'Globular cluster', 'Association of stars', 'Star cluster and nebula'].includes(target.type)) category = 'cluster'
    else if (target.type === 'Planetary nebula') category = 'planetary'
  }

  // L-Ultimate passes H-alpha/OIII, not general continuum. Mixed/unknown labels
  // do not establish emission-line suitability. https://www.optolong.com/cms/document/detail/id/250.html
  const mixed = target.type === 'Star cluster and nebula' && !categoryOverrides[target.id]

  const filter: TargetFilterChoice = mixed || category === 'other' ? 'uncertain'
    : category === 'emission' || category === 'planetary' ? 'dual-band' : 'broadband'

  const filterReason: DiscoveryCandidate['filterReason'] = filter === 'dual-band' ? 'emission-lines'
    : filter === 'broadband' ? 'continuum' : 'mixed-or-unknown'

  const typeAppeal: Record<TargetCategory, number> = {
    emission: 0.6, 'reflection-dark': 0.55, galaxy: 0.45, cluster: 0.4, planetary: 0.5, other: 0.15,
  }

  // Catalog angular extent is only a visual-interest hint: never inferred sensor fit.
  const size = target.majorAxisArcminutes ?? 0
  const extentAppeal = 0.25 * Math.min(1, Math.log1p(Math.max(0, size)) / Math.log(121))
  const appeal = typeAppeal[category] + extentAppeal + (showpieces.has(target.id) ? 0.1 : 0)

  return { category, filter, filterReason, appeal }
}

function usableSite(site: Site | null): site is Site {
  return site !== null && Number.isFinite(site.latitudeDegrees) && Math.abs(site.latitudeDegrees) <= 90
    && Number.isFinite(site.longitudeDegrees) && Math.abs(site.longitudeDegrees) <= 180
    && (site.elevationMeters === undefined || Number.isFinite(site.elevationMeters))
}

function darkWindow(site: Site, now: Date): DiscoveryWindow | null {
  const observer = new Observer(site.latitudeDegrees, site.longitudeDegrees, site.elevationMeters ?? 0)
  const sun = Equator(Body.Sun, now, observer, true, true)
  const darkNow = Horizon(now, observer, sun.ra, sun.dec).altitude < -18
  const dusk = darkNow ? now : SearchAltitude(Body.Sun, observer, -1, now, 1, -18)?.date

  if (!dusk) return null
  const dawn = SearchAltitude(Body.Sun, observer, 1, dusk, 1, -18)?.date

  return {
    startsAt: dusk.toISOString(),
    endsAt: (dawn ?? new Date(dusk.getTime() + day)).toISOString(),
    kind: !dawn ? 'polar-night' : darkNow ? 'current-night' : 'upcoming-night',
  }
}

interface SiderealSample { at: number, angle: number }

function siderealSamples(window: DiscoveryWindow, longitude: number): SiderealSample[] {
  const start = Date.parse(window.startsAt)
  const end = Date.parse(window.endsAt)
  const samples: SiderealSample[] = []

  for (let at = start; ; at = Math.min(end, at + 900_000)) {
    let angle = (SiderealTime(new Date(at)) * 15 + longitude) * radians
    const previous = samples.at(-1)

    if (previous) while (angle < previous.angle) angle += turn
    samples.push({ at, angle })

    if (at === end) break
  }

  return samples
}

/** Sidereal motion is smooth; interpolation shares all time/ephemeris work across the catalog. */
function timeAtAngle(samples: readonly SiderealSample[], angle: number): number {
  let low = 0
  let high = samples.length - 1

  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2)

    if (samples[middle]!.angle < angle) low = middle
    else high = middle
  }

  const a = samples[low]!
  const b = samples[high]!

  return a.at + (b.at - a.at) * Math.max(0, Math.min(1, (angle - a.angle) / (b.angle - a.angle)))
}

function altitude(x: number, y: number, z: number, sinLatitude: number, cosLatitude: number, angle: number) {
  return Math.asin(clamp(sinLatitude * z + cosLatitude * (x * Math.cos(angle) + y * Math.sin(angle)))) / radians
}

function opportunity(
  position: Vector, samples: readonly SiderealSample[], sinLatitude: number, cosLatitude: number, currentAngle: number,
): TargetOpportunity | null {
  const { x, y, z } = position
  const base = sinLatitude * z
  const amplitude = cosLatitude * Math.hypot(x, y)
  const threshold = Math.sin(minimumAltitude * radians)

  if (base + amplitude <= threshold + 1e-12) return null

  const halfArc = amplitude < 1e-12 || base - amplitude >= threshold ? Math.PI
    : Math.acos(clamp((threshold - base) / amplitude))

  const first = samples[0]!
  const last = samples.at(-1)!
  const ra = Math.atan2(y, x)
  const currentAltitudeDegrees = altitude(x, y, z, sinLatitude, cosLatitude, currentAngle)
  const intervals: Array<{ start: number, end: number, transit: number }> = []

  if (halfArc === Math.PI) {
    const transit = ra + Math.ceil((first.angle - ra) / turn) * turn
    intervals.push({ start: first.angle, end: last.angle, transit })
  } else {
    for (let cycle = Math.floor((first.angle - ra) / turn); cycle <= Math.ceil((last.angle - ra) / turn); cycle++) {
      const transit = ra + cycle * turn
      const start = Math.max(first.angle, transit - halfArc)
      const end = Math.min(last.angle, transit + halfArc)

      if (end > start) intervals.push({ start, end, transit })
    }
  }

  let best: TargetOpportunity | null = null
  let bestValue = -1

  for (const interval of intervals) {
    const startsAt = timeAtAngle(samples, interval.start)
    const endsAt = timeAtAngle(samples, interval.end)
    const peakAngle = Math.max(interval.start, Math.min(interval.end, interval.transit))
    // A circumpolar interval may end before the next transit: compare both edges too.
    const peakOptions = [peakAngle, interval.start, interval.end]
    peakOptions.sort((a, b) => altitude(x, y, z, sinLatitude, cosLatitude, b) - altitude(x, y, z, sinLatitude, cosLatitude, a) || a - b)
    const bestAngle = peakOptions[0]!
    const bestAltitudeDegrees = altitude(x, y, z, sinLatitude, cosLatitude, bestAngle)
    const usefulMinutes = (endsAt - startsAt) / 60_000

    if (usefulMinutes <= 0) continue
    const value = usefulMinutes * Math.sin(bestAltitudeDegrees * radians)

    if (value > bestValue) {
      bestValue = value
      best = {
        startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), usefulMinutes,
        bestAt: new Date(timeAtAngle(samples, bestAngle)).toISOString(), bestAltitudeDegrees, currentAltitudeDegrees,
      }
    }
  }

  return best
}

/** Read-only and deterministic. Missing/invalid site and no darkness retain a photographic
 * catalog order but mark every opportunity unavailable. Solar crossings are searched only
 * over the coming day; continuous darkness uses an explicit 24-hour interval.
 * Catalog coordinates are precessed/nutated once at the window midpoint. Omitting aberration
 * (under 0.01 degree) and within-night precession is appropriate to this approximate ranking;
 * precise target inspection still uses sky.ts. No weather, Moon penalty or obstruction policy.
 */
export function discoverTargets({ targets, site, now }: DiscoveryInput): TargetDiscovery {
  if (!Number.isFinite(now.getTime())) throw new RangeError('Discovery requires a valid current time')
  const validSite = usableSite(site) ? site : null
  const window = validSite ? darkWindow(validSite, now) : null
  const samples = window && validSite ? siderealSamples(window, validSite.longitudeDegrees) : null
  const epoch = MakeTime(window ? new Date((Date.parse(window.startsAt) + Date.parse(window.endsAt)) / 2) : now)
  const rotation = samples ? Rotation_EQJ_EQD(epoch) : null
  const latitude = (validSite?.latitudeDegrees ?? 0) * radians
  const currentAngle = samples && validSite ? (SiderealTime(now) * 15 + validSite.longitudeDegrees) * radians : 0

  const candidates = targets.map((target): DiscoveryCandidate => {
    const details = description(target)
    let available: TargetOpportunity | null = null

    if (samples && rotation) {
      const ra = target.raDegrees * radians
      const dec = target.decDegrees * radians
      const position = RotateVector(rotation, new Vector(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec), epoch))
      available = opportunity(position, samples, Math.sin(latitude), Math.cos(latitude), currentAngle)
    }

    // Duration remains decisive: a nearly-set showpiece cannot outrank a long useful session
    // solely on its name. Four hours saturates this preference; size is not equipment fit.
    const timeWeight = available ? Math.sqrt(Math.min(1, available.usefulMinutes / 240)) : 1
    const altitudeWeight = available ? 0.5 + 0.5 * Math.sin(available.bestAltitudeDegrees * radians) : 1

    return {
      target, category: details.category, filter: details.filter, filterReason: details.filterReason,
      eligible: available !== null, opportunity: available, score: 100 * details.appeal * timeWeight * altitudeWeight,
    }
  })

  candidates.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score
    || (a.target.id < b.target.id ? -1 : a.target.id > b.target.id ? 1 : 0))

  return { observedAt: now.toISOString(), status: !validSite ? 'site-unavailable' : !window ? 'no-darkness' : 'available', window, candidates }
}
