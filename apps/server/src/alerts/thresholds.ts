import { z } from 'zod'

const ratio = z.number().gt(0).lte(1)

const positive = z.number().positive()

/**
 * Every number the alert rules use. The defaults come from the 2026-10-17
 * night (healthy frames: 1100-1600 stars, HFR 2.5-3.1 px) and its failures.
 */
export const thresholdsSchema = z.strictObject({
  baselineFrames: z.number().int().positive().default(5),
  minBaselineFrames: z.number().int().positive().default(3),
  // Star counts depend on the optical path, so ratios mean little on a sparse
  // field. Below this baseline only an empty frame raises an alert.
  minBaselineStarsForRatios: positive.default(10),
  minBaselineStarsForEmptyFrame: positive.default(3),
  confirmFrames: z.number().int().positive().default(2),

  starsLowRatio: ratio.default(0.6),
  starsCollapsedRatio: ratio.default(0.3),
  starsRecoveredRatio: ratio.default(0.8),
  starsDecliningRatio: ratio.default(0.7),
  starsDecliningClearRatio: ratio.default(0.85),

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

  requireOrder(value.starsCollapsedRatio < value.starsLowRatio, 'starsCollapsedRatio must be below starsLowRatio')
  requireOrder(value.starsLowRatio <= value.starsRecoveredRatio, 'starsRecoveredRatio must not be below starsLowRatio')
  requireOrder(value.starsDecliningRatio <= value.starsDecliningClearRatio, 'starsDecliningClearRatio must not be below starsDecliningRatio')
  requireOrder(value.hfrHighClearPixels <= value.hfrHighPixels, 'hfrHighClearPixels must not exceed hfrHighPixels')
  requireOrder(value.hfrHighPixels < value.hfrBadPixels, 'hfrHighPixels must be below hfrBadPixels')
  requireOrder(value.hfrBadClearPixels <= value.hfrBadPixels, 'hfrBadClearPixels must not exceed hfrBadPixels')
  requireOrder(value.meridianImminentMinutes < value.meridianNearMinutes, 'meridianImminentMinutes must be below meridianNearMinutes')
})

export type AlertThresholds = z.infer<typeof thresholdsSchema>

export const defaultThresholds: AlertThresholds = thresholdsSchema.parse({})
