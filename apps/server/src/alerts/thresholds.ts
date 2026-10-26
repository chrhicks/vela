import { z } from 'zod'

const ratio = z.number().gt(0).lte(1)

const positive = z.number().positive()

/**
 * Every number the alert rules use. The star numbers are `tools/star-bench` output for star
 * measurement version 3, regenerated and not edited (`thresholds.test.ts` fails when the version moves
 * and this comment still names the old one):
 *
 *   pnpm --silent --filter @vela/star-bench star-bench ~/.local/share/vela/saved-images \
 *     --frames bots/observer/specs/star-measurement/harness/todo.txt \
 *     --restart-at 2026-10-24T00:00:00Z --labels tools/star-bench/labels --sweep
 *
 * That is 717 saved frames from five nights. The labels in `tools/star-bench/labels` pick the
 * thresholds on 2026-10-18 Andromeda, 2026-10-24 Heart and 2026-10-25 Soul, and hold out 2026-10-24
 * North America and the 2026-10-23 Heart evening, which must raise nothing. The held-out nights were
 * seen while the count was chosen, so they are regression evidence, not independent validation.
 *
 * The count is `strong` stars (flux S/N 100 or more), not `measured`:
 * - Steadiness, the spread of log(count / previous count), measured then strong: Andromeda 0.048
 *   and 0.034, Heart evening 0.024 and 0.043, Heart 0.085 and 0.100, North America 0.078 and 0.070,
 *   Soul 0.039 and 0.034. Neither is steadier on every night, so steadiness did not decide it.
 * - `starsDecliningRatio` has room with strong and none with measured. A value that raises the
 *   creeping haze on Heart (calibration) and stays quiet on North America (held out) is 0.57 to 0.66
 *   with strong. With measured it is 0.62 and nothing else: the Heart creep reads 0.62 and the North
 *   America wander 0.63.
 * - A camera that smears the stars takes strong to zero one frame sooner: `stars-collapsed` on the
 *   2026-10-18 snag at 03:32:17Z against 03:33:25Z.
 * - What it costs: the Heart haze raises `stars-dropping` at 01:33:27Z, one frame (98 s) after
 *   measured does, and a field or exposure with under 10 strong stars leaves the ratio rules silent.
 *   `stars-declining` warns first, at 01:15:36Z.
 *
 * Each ratio default sits inside the range the bench finds for it, calibration and held out
 * together, with the margin to each end. A margin under 0.05 moves the default to the middle:
 * - `starsDropFraction` 0.5: 0.42 to 0.65 (-0.08 / +0.15). The low end is the deepest fall on a
 *   healthy night; the high end is where the Heart haze stops raising it.
 * - `starsCollapsedRatio` 0.15: nothing fails below it, and from 0.32 the Heart haze raises it (-0.14 /
 *   +0.16). Clouds that take the count to a few stars stay far under it.
 * - `starsDecliningRatio` 0.62: 0.57 to 0.66 (-0.05 / +0.04). It was 0.6, which left 0.03 to the creep
 *   on the low side.
 * Healthy strong counts were 64 to 595 per night (medians), over the baseline floors of 10 and 3.
 *
 * Causes are named from the last `starsSmoothingFrames` frames against the frames no alert called bad.
 * Healthy windows (539 frames) and the labelled events, the extremes over three-frame windows:
 * - `causeSkyRatio` 1.5: brightest sky over the normal sky is at most 1.03 on healthy windows and
 *   1.04 in the haze, and 13.1 at the Soul flash.
 * - `causePeaksRatio` 0.5: median peaks over the normal peaks is at least 0.63 on healthy windows.
 *   The haze alert reads "few peaks".
 * - `causeBlendedShareRise` 0.4: the rise of the blended share of peaks is at most 0.12 on healthy
 *   windows and 0.53 on the snag.
 * - `causeTrailedAxisRatio` 1.7, on the strong stars of at least two frames that must all reach it:
 *   no three-frame window of the 717 frames does (1.0% reach 1.6), though one frame in seven alone does.
 *   No labelled event is trailed in several frames, so this one is the #176 scale and a unit test, not
 *   an event.
 * - Noise adds nothing: its rise is 1.15 on healthy windows, 1.16 in the haze and 14.7 with the flash.
 *
 * Earlier checks, still true: healthy frames swing 2x with HFR flat, so every star comparison uses
 * the median of `starsSmoothingFrames` frames. A window of 10 minutes is about 6 frames at 90 s and
 * still 3 at 180 s, enough to see a fall start without the slow wander of the sky counting as one.
 * The count rises as focus gets worse, so a refocus makes it fall; the monitor starts the history
 * over when the focuser moves.
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

  starsDecliningRatio: ratio.default(0.62),
  starsDecliningClearRatio: ratio.default(0.8),
  starsDecliningWindowMinutes: positive.default(30),

  // Names a cause on a star alert, from the last `starsSmoothingFrames` frames against the normal.
  causeSkyRatio: positive.default(1.5),
  causeTrailedAxisRatio: positive.default(1.7),
  causeBlendedShareRise: ratio.default(0.4),
  causePeaksRatio: ratio.default(0.5),

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
