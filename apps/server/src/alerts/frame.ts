import type { CaptureImageStatistics } from '@vela/model/web'

import { starAlgorithmVersion } from '../imaging/statistics.js'
import type { Frame } from './rules.js'

export type AlertCountInput = 'measured' | 'strong'

/**
 * The star count the star alerts compare. `strong` (flux S/N 100 or more) leaves `stars-declining` a
 * range of 0.09 to sit in where `measured` leaves a single value, and goes to zero a frame sooner when
 * stars smear. The bench numbers, and what it costs, are in `thresholds.ts`.
 */
export const alertCountInput: AlertCountInput = 'strong'

/**
 * The frame the alert rules read, or null when the statistics cannot give one: a record from another
 * algorithm version, or one without the named outputs. Counts of different versions never share a
 * history, because nothing else puts a frame there. A missing output is no frame, never zero stars.
 */
export function alertFrame(
  capturedAt: number,
  statistics: CaptureImageStatistics,
  input: AlertCountInput = alertCountInput,
): Frame | null {
  const { algorithm, medianHfrPixels, detections, rejected, sky, axisRatio } = statistics
  const stars = statistics[input]

  if (
    algorithm.version !== starAlgorithmVersion ||
    stars === undefined ||
    detections === undefined ||
    rejected === undefined ||
    sky === undefined ||
    !Number.isFinite(sky)
  )
    return null

  return {
    capturedAt,
    stars,
    hfrPixels: medianHfrPixels,
    evidence: { peaks: detections, blended: rejected.blended, sky, axisRatio: axisRatio ?? null },
  }
}
