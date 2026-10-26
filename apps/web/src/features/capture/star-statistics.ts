import { z } from 'zod'
import type { CaptureImageStatistics } from '@vela/model/web'

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

/** The statistics the server projects for a frame. The named star outputs are absent on older frames. */
export const starStatistics = z
  .object({
    algorithm: z.object({ version: z.number().int().positive() }).default({ version: 1 }),
    detectedStars: count,
    medianHfrPixels: z.number().positive().nullable(),
    detections: count.optional(),
    measured: count.optional(),
    strong: count.optional(),
    rejected: z
      .object({
        blended: count,
        edge: count,
        unconverged: count,
        faint: count,
        saturated: count,
        wings: count,
        elongated: count,
        floor: count,
      })
      .optional(),
    sky: z.number().optional(),
    noise: z.number().nonnegative().optional(),
    axisRatio: z.number().min(1).nullable().optional(),
  })
  .refine(value =>
    value.detectedStars === 0 ? value.medianHfrPixels === null : value.medianHfrPixels !== null,
  )

/** "264 measured of 1141 peaks", or "264 stars" for a frame measured before peaks were recorded. */
export function starCounts({ detectedStars, detections }: CaptureImageStatistics) {
  return detections === undefined
    ? `${detectedStars} stars`
    : `${detectedStars} measured of ${detections} ${detections === 1 ? 'peak' : 'peaks'}`
}

/** "1.24", or null on a frame without enough strong stars or measured before the axis ratio was recorded. */
export function axisRatio({ axisRatio }: CaptureImageStatistics) {
  return axisRatio == null ? null : axisRatio.toFixed(2)
}

/** The frame's sky level in raw sample units, or null on a frame measured before it was recorded. */
export function skyLevel({ sky }: CaptureImageStatistics) {
  return sky === undefined ? null : String(Number(sky.toPrecision(4)))
}
