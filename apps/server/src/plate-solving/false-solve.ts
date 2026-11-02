import type { AstapSolution, AstapSolver } from '@vela/rig-astap'
import type { SkyPosition } from './judged-solver.js'

/** The scale every good frame of the audit corpus has. */
export const rigArcsecPerPixel = 1.9386

/** The field height, in degrees, that a camera of `height` rows at the rig's scale gives ASTAP. */
export const fieldHeightDegreesFor = (height: number) => (rigArcsecPerPixel * height) / 3600

/**
 * The false solve of the audit's alignment trial, as synthetic values: 2.3162 arcsec/px, mirrored, 100.9 degrees from
 * where the mount claimed to point. ASTAP counted 29 stars for it and reported it solved.
 */
export function falseSolve(claimed: SkyPosition, frame: { width: number; height: number }): AstapSolution {
  const scale = 2.3162 / 3600
  const centre = { raDegrees: claimed.raDegrees, decDegrees: claimed.decDegrees - 100.9 }

  return {
    status: 'solved',
    radiusDegrees: 180,
    centre,
    wcs: { ...frame, referenceX: (frame.width + 1) / 2, referenceY: (frame.height + 1) / 2, ...centre, cd: [0, scale, scale, 0] },
  }
}

/** A solve of the rig's own scale, rotated but not mirrored, one degree from the claim. */
export function goodSolve(claimed: SkyPosition, frame: { width: number; height: number }): AstapSolution {
  const scale = rigArcsecPerPixel / 3600
  const centre = { raDegrees: claimed.raDegrees, decDegrees: claimed.decDegrees + 1 }

  return {
    status: 'solved',
    radiusDegrees: 10,
    centre,
    wcs: { ...frame, referenceX: (frame.width + 1) / 2, referenceY: (frame.height + 1) / 2, ...centre, cd: [0, scale, -scale, 0] },
  }
}

export const astapReturning = (solution: AstapSolution): AstapSolver => ({ solve: async () => solution })
