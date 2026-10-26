import { z } from 'zod'

const ratio = z.number().gt(0).lte(1)

const positive = z.number().positive()

/**
 * Every number the alert rules use. The defaults come from two nights.
 *
 * 2026-10-17 (healthy frames: 1100-1600 stars, HFR 2.5-3.1 px) and its failures.
 *
 * 2026-10-23, 90 s frames through a 3 nm dual-band filter (fixtures/night-20261023-frames.json holds
 * the counts as star measurement version 1 recorded them). The numbers below are `tools/star-bench`
 * output for version 3, the same frames with the Bayer HFR floor at 1.0 px (version 2) and the
 * elongation gate on stars of S/N 200 or more only. Version 2 is given for comparison:
 * - Healthy frames swing 2x with HFR flat in version 1 (101, 88, 181, 126, 84) and little in version 3
 *   (274, 289, 314, 308, 325; spread 0.531 down to 0.085; version 2: 0.120). A single frame still says
 *   little, so every star comparison uses the median of `starsSmoothingFrames` frames.
 * - Smoothed that way, the 00:01Z run stays between 153 and 325 stars until 01:25Z (version 2: 100 to
 *   215), and its worst fall within 10 minutes is to 0.76 of the peak (version 2: 0.75).
 *   `starsDropFraction` 0.5 sits well under that. The haze at 01:26Z takes the smoothed count from
 *   185 to 58 (0.31) in about 6 minutes and then to 48, so it warns at 01:31Z, after `confirmFrames`
 *   (version 2: 122 to 41 and 34, warned at the same frame).
 * - A window of 10 minutes is about 6 frames at 90 s and still 3 at 180 s, enough to see a fall
 *   start without the slow wander of the sky counting as one.
 * - The slow wander is `stars-declining`: the median of 30 minutes against the 30 before. In that
 *   run, before the haze, it never goes below 0.62 of the one before (version 2: 0.66), so 0.6
 *   stays quiet, with less room than before.
 * - The count rises as focus gets worse, by less than it did (300 to 329 stars while HFR goes 1.47 to
 *   2.02; version 2: 219 to 278), so a refocus makes it fall. The monitor starts the history over when
 *   the focuser moves.
 * - Real clouds take the count to a few stars, so `stars-collapsed` at 0.15 of the baseline stays
 *   below the haze minimum (48 of 185, 0.26; version 2: 34 of 123, 0.28) and above a cloud-out (a
 *   few stars).
 */
export const thresholdsSchema = z.strictObject({
  baselineFrames: z.number().int().positive().default(5),
  minBaselineFrames: z.number().int().positive().default(3),
  // Star counts depend on the optical path, so ratios mean little on a sparse
  // field. Below this baseline only an empty frame raises an alert.
  minBaselineStarsForRatios: positive.default(10),
  minBaselineStarsForEmptyFrame: positive.default(3),
  // A run that has not built a baseline of at least `minBaselineStarsForEmptyFrame` stars by
  // this many frames has none of the star alerts working. 5 is `baselineFrames`: the window a
  // baseline is taken from. It is 7.5 min of the 90 s frames from 2026-10-23, and a cloud over
  // the first three frames clears itself as soon as the baseline fills with sky.
  noStarsFrames: z.number().int().positive().default(5),
  confirmFrames: z.number().int().positive().default(2),

  starsSmoothingFrames: z.number().int().positive().default(3),

  starsDropFraction: z.number().gt(0).lt(1).default(0.5),
  starsDropWindowMinutes: positive.default(10),

  starsCollapsedRatio: ratio.default(0.15),
  starsRecoveredRatio: ratio.default(0.5),

  starsDecliningRatio: ratio.default(0.6),
  starsDecliningClearRatio: ratio.default(0.8),
  starsDecliningWindowMinutes: positive.default(30),

  hfrHighPixels: positive.default(4),
  hfrHighClearPixels: positive.default(3.5),
  hfrBadPixels: positive.default(6),
  hfrBadClearPixels: positive.default(5),

  trackingStoppedReadings: z.number().int().positive().default(2),

  // The AM5 stops tracking 1.004 degrees past the meridian with its flip
  // disabled. Set 1.0 once post-meridian tracking is on with a 15 degree limit.
  meridianTrackLimitHours: z.number().default(0.0669),
  meridianNearMinutes: positive.default(20),
  meridianImminentMinutes: positive.default(5),

  rigUnreachableSeconds: positive.default(30),
  framesStalledGraceSeconds: positive.default(30),
}).superRefine((value, context) => {
  function requireOrder(ok: boolean, message: string) {
    if (!ok) context.addIssue({ code: 'custom', message })
  }

  requireOrder(value.starsCollapsedRatio < value.starsRecoveredRatio, 'starsCollapsedRatio must be below starsRecoveredRatio')
  requireOrder(value.starsDecliningRatio <= value.starsDecliningClearRatio, 'starsDecliningClearRatio must not be below starsDecliningRatio')
  requireOrder(value.hfrHighClearPixels <= value.hfrHighPixels, 'hfrHighClearPixels must not exceed hfrHighPixels')
  requireOrder(value.hfrHighPixels < value.hfrBadPixels, 'hfrHighPixels must be below hfrBadPixels')
  requireOrder(value.hfrBadClearPixels <= value.hfrBadPixels, 'hfrBadClearPixels must not exceed hfrBadPixels')
  requireOrder(value.meridianImminentMinutes < value.meridianNearMinutes, 'meridianImminentMinutes must be below meridianNearMinutes')
})

export type AlertThresholds = z.infer<typeof thresholdsSchema>

export const defaultThresholds: AlertThresholds = thresholdsSchema.parse({})
