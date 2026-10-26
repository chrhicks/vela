/** About one pixel of drift in 3 minutes at 1.92 arcsec per pixel; first guess, tune with real nights. */
export const GOOD_ENOUGH_ARCSEC = 120

export const REFERENCE_EXPOSURE_MINUTES = 3

/** Worst-case drift per minute of exposure for each arcminute of polar error: 2π per sidereal day, in arcseconds. */
const DRIFT_ARCSEC_PER_MINUTE_PER_ARCMINUTE = Math.PI / 12

/**
 * Arcseconds of drift over the reference exposure when the total polar error
 * is good enough to stop adjusting, else null. Exactly the threshold is not good enough.
 */
export function goodEnoughDrift(totalArcsec: number) {
  if (totalArcsec >= GOOD_ENOUGH_ARCSEC) return null

  return DRIFT_ARCSEC_PER_MINUTE_PER_ARCMINUTE * (totalArcsec / 60) * REFERENCE_EXPOSURE_MINUTES
}
