import type { Run } from './runs.ts'
import { starStatistics } from './test-statistics.ts'

export const runStart = Date.parse('2030-01-01T02:00:00Z')

export const exposureMs = 90_000

/** The capture time of the frame at `index` in a run made by `syntheticRun`. */
export const frameTime = (index: number) => runStart + index * exposureMs

/** A run of 90 s frames of Fixture Nebula, one per count, read by the alerts as its strong stars. */
export function syntheticRun(counts: number[], hfrPixels = 2): Run {
  return {
    target: 'Fixture Nebula',
    exposureSeconds: 90,
    frames: counts.map((stars, index) => ({ capturedAt: frameTime(index), stars, hfrPixels })),
    statistics: counts.map(stars => starStatistics(stars * 2, hfrPixels)),
  }
}

/** Counts that sit at `level`, fall to `low` for `length` frames starting at `at`, and come back. */
export function haze(frames: number, level: number, at: number, length: number, low: number) {
  return Array.from({ length: frames }, (_, index) => (index >= at && index < at + length ? low : level))
}
