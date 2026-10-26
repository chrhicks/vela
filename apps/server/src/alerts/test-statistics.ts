import type { CaptureImageStatistics } from '@vela/model/web'

import { starAlgorithmVersion } from '../imaging/statistics.js'

/** A frame's statistics as the running algorithm records them, with `stars` as the alert count. */
export function starStatistics(stars: number, medianHfrPixels: number | null): CaptureImageStatistics {
  return {
    algorithm: { version: starAlgorithmVersion },
    detectedStars: stars,
    medianHfrPixels,
    detections: stars * 3,
    measured: stars,
    strong: stars,
    rejected: { blended: 0, edge: 0, unconverged: 0, faint: stars * 2, saturated: 0, wings: 0, elongated: 0, floor: 0 },
    sky: 500,
    noise: 4,
    axisRatio: null,
  }
}
