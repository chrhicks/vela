import { SiderealTime } from 'astronomy-engine'
import { fromMount, toMount, type Site } from '../astronomy/coordinates.js'
import { projectSky, type PlateWcs, type SkyPosition } from '../plate-solving/solver.js'
import type { AlignmentSample } from './geometry.js'

/** The geometry sample uses exposure midpoint. Keep the original capture start
 * and its provenance separately for the user-facing image timestamp. */
export function physicalAlignmentSample(
  solved: SkyPosition,
  capture: { capturedAt: string, exposureSeconds: number },
  site: Site,
): AlignmentSample {
  const startedAt = Date.parse(capture.capturedAt)

  if (!Number.isFinite(startedAt) || !Number.isFinite(capture.exposureSeconds) || capture.exposureSeconds <= 0) {
    throw new Error('Physical alignment requires a valid exposure start and duration')
  }

  const midpoint = new Date(startedAt + capture.exposureSeconds * 500)

  return {
    ...toMount(solved, 'topocentric', midpoint, site),
    capturedAt: midpoint.toISOString(),
    siderealTimeDegrees: localSiderealDegrees(midpoint, site),
  }
}

export function localSiderealDegrees(at: Date, site: Site): number {
  if (!Number.isFinite(at.getTime()) || !Number.isFinite(site.longitudeDegrees) || Math.abs(site.longitudeDegrees) > 180
    || !Number.isFinite(site.latitudeDegrees) || Math.abs(site.latitudeDegrees) > 90
    || (site.elevationMeters !== undefined && !Number.isFinite(site.elevationMeters))) {
    throw new Error('Physical alignment requires a valid observing time and site')
  }

  return ((SiderealTime(at) * 15 + site.longitudeDegrees) % 360 + 360) % 360
}

/** The fitter returns an apparent equator-of-date target; ASTAP WCS is J2000. */
export function projectPhysicalAlignmentTarget(
  wcs: PlateWcs,
  correctionTarget: SkyPosition,
  sample: AlignmentSample,
  site: Site,
) {
  return projectSky(wcs, fromMount(correctionTarget, 'topocentric', new Date(sample.capturedAt), site))
}
