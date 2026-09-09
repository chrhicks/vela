import {
  BaryState, Body, C_AUDAY, Equator, EquatorFromVector, Horizon, Illumination, MakeTime, MoonPhase,
  Observer, ObserverState, RotateVector, Rotation_EQD_EQJ, Rotation_EQJ_EQD,
  Spherical, Vector, VectorFromSphere,
} from 'astronomy-engine'
import type { TargetPosition, TargetSkyPath } from '@vela/model/web'
import type { PlateWcs } from '../plate-solving/solver.js'

export interface Site { latitudeDegrees: number, longitudeDegrees: number, elevationMeters?: number }
const radians = Math.PI / 180
const wrap = (degrees: number) => (degrees % 360 + 360) % 360

function vector(position: TargetPosition, date: Date) {
  return VectorFromSphere(new Spherical(position.decDegrees, position.raDegrees, 1), date)
}

function position(value: Vector): TargetPosition {
  const equatorial = EquatorFromVector(value)
  return { raDegrees: wrap(equatorial.ra * 15), decDegrees: equatorial.dec }
}

/** Distant catalog objects: precession/nutation plus annual and diurnal aberration.
 * Refraction is deliberately excluded from equatorial mount coordinates.
 * The first-order aberration remainder is below 0.01 arcsec; proper motion,
 * parallax and solar deflection are immaterial to these deep-sky centers.
 */
function aberration(value: Vector, date: Date, site: Site, direction: 1 | -1) {
  const earth = BaryState(Body.Earth, date)
  const observer = ObserverState(date, new Observer(site.latitudeDegrees, site.longitudeDegrees, site.elevationMeters ?? 0), false)
  const velocity = [earth.vx + observer.vx, earth.vy + observer.vy, earth.vz + observer.vz]
  const length = Math.hypot(value.x, value.y, value.z)
  const unit = [value.x / length, value.y / length, value.z / length]
  const beta = velocity.map(v => v / C_AUDAY * direction)
  const dot = unit.reduce((sum, component, index) => sum + component * beta[index]!, 0)
  return new Vector(unit[0]! + beta[0]! - dot * unit[0]!, unit[1]! + beta[1]! - dot * unit[1]!, unit[2]! + beta[2]! - dot * unit[2]!, MakeTime(date))
}

export function toMount(positionJ2000: TargetPosition, frame: string, date: Date, site: Site): TargetPosition {
  if (frame === 'j2000') return { ...positionJ2000 }
  if (frame !== 'topocentric') throw new Error(`Mount coordinate frame ${frame} is not supported for framing`)
  return position(RotateVector(Rotation_EQJ_EQD(date), aberration(vector(positionJ2000, date), date, site, 1)))
}

export function fromMount(mountPosition: TargetPosition, frame: string, date: Date, site: Site): TargetPosition {
  if (frame === 'j2000') return { ...mountPosition }
  if (frame !== 'topocentric') throw new Error(`Mount coordinate frame ${frame} is not supported for framing`)
  return position(aberration(RotateVector(Rotation_EQD_EQJ(date), vector(mountPosition, date)), date, site, -1))
}

export function angularDistance(a: TargetPosition, b: TargetPosition): number {
  const dec1 = a.decDegrees * radians
  const dec2 = b.decDegrees * radians
  const half = Math.sin((dec2 - dec1) / 2) ** 2 + Math.cos(dec1) * Math.cos(dec2) * Math.sin((b.raDegrees - a.raDegrees) * radians / 2) ** 2
  return 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, half)))) / radians
}

/** Inverse TAN projection, preserving the CD matrix's scale, rotation and parity. */
export function skyAtPixel(wcs: PlateWcs, x: number, y: number): TargetPosition {
  const dx = x + 1 - wcs.referenceX
  const dy = y + 1 - wcs.referenceY
  const east = (wcs.cd[0] * dx + wcs.cd[1] * dy) * radians
  const north = (wcs.cd[2] * dx + wcs.cd[3] * dy) * radians
  const dec = wcs.decDegrees * radians
  const denominator = Math.cos(dec) - north * Math.sin(dec)
  return {
    raDegrees: wrap(wcs.raDegrees + Math.atan2(east, denominator) / radians),
    decDegrees: Math.atan2(Math.sin(dec) + north * Math.cos(dec), Math.hypot(denominator, east)) / radians,
  }
}

export function plateCorners(wcs: PlateWcs): TargetPosition[] {
  return [[-0.5, -0.5], [wcs.width - 0.5, -0.5], [wcs.width - 0.5, wcs.height - 0.5], [-0.5, wcs.height - 0.5]].map(([x, y]) => skyAtPixel(wcs, x!, y!))
}

export function skyPath(target: TargetPosition, site: Site, now: Date): TargetSkyPath {
  const observer = new Observer(site.latitudeDegrees, site.longitudeDegrees, site.elevationMeters ?? 0)
  // A local solar noon-to-noon span includes the current/coming observing night,
  // without assuming the server or browser timezone is the observatory's zone.
  const solarOffset = site.longitudeDegrees / 15 * 3_600_000
  const local = new Date(now.getTime() + solarOffset)
  let noon = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 12) - solarOffset
  if (now.getTime() < noon) {
    const sunNow = Equator(Body.Sun, now, observer, true, true)
    if (Horizon(now, observer, sunNow.ra, sunNow.dec).altitude < -18) noon -= 86_400_000
  }
  const horizontal = (at: Date) => {
    const apparent = toMount(target, 'topocentric', at, site)
    return Horizon(at, observer, apparent.raDegrees / 15, apparent.decDegrees)
  }
  const samples = Array.from({ length: 97 }, (_, index) => {
    const at = new Date(noon + index * 900_000)
    const sun = Equator(Body.Sun, at, observer, true, true)
    const targetHorizontal = horizontal(at)
    const moon = Equator(Body.Moon, at, observer, true, true)
    const moonHorizontal = Horizon(at, observer, moon.ra, moon.dec)
    return {
      at: at.toISOString(),
      azimuthDegrees: targetHorizontal.azimuth,
      altitudeDegrees: targetHorizontal.altitude,
      sunAltitudeDegrees: Horizon(at, observer, sun.ra, sun.dec).altitude,
      moon: {
        azimuthDegrees: moonHorizontal.azimuth,
        altitudeDegrees: moonHorizontal.altitude,
        illuminationFraction: Illumination(Body.Moon, at).phase_fraction,
        waxing: MoonPhase(at) < 180,
      },
    }
  })
  const windows: TargetSkyPath['aboveHorizonDuringDarkness'] = []
  let start: string | null = null
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index]!
    const visible = sample.altitudeDegrees > 0 && sample.sunAltitudeDegrees < -18
    if (visible && start === null) start = sample.at
    if (start !== null && (!visible || index === samples.length - 1)) {
      windows.push({ startsAt: start, endsAt: sample.at })
      start = null
    }
  }
  return {
    observedAt: now.toISOString(), startsAt: samples[0]!.at, endsAt: samples.at(-1)!.at,
    samples, currentAltitudeDegrees: horizontal(now).altitude, highestAltitudeDegrees: Math.max(...samples.map(sample => sample.altitudeDegrees)),
    aboveHorizonDuringDarkness: windows,
  }
}
