import type { StarStatistics } from './measure.ts'

/** A frame's statistics with the named outputs filled in plausibly from its count and HFR. */
export function starStatistics(detectedStars: number, medianHfrPixels: number | null): StarStatistics {
  return {
    algorithm: { version: 2 },
    detectedStars,
    medianHfrPixels,
    detections: detectedStars * 3,
    measured: detectedStars,
    strong: Math.floor(detectedStars / 2),
    rejected: { blended: 0, edge: 0, unconverged: 0, faint: detectedStars * 2, saturated: 0, wings: 0, elongated: 0, floor: 0 },
    sky: 500,
    noise: 4,
  }
}
