import type { RecordedStatistics, SavedFrame } from './frames.ts'
import type { Measurement } from './measure.ts'

/** Both numbers come from the same code on the same samples, so anything above rounding is a change. */
export const hfrTolerancePixels = 1e-9

export type Comparison =
  | { status: 'match' }
  | { status: 'differ'; differences: string[]; hfrDifferencePixels: number | null }
  | { status: 'unrecorded' }
  | { status: 'failed'; reason: string }

export interface FrameResult {
  frame: SavedFrame
  measurement: Measurement
  comparison: Comparison
}

/** A missing record or a failed measurement is never a match. */
export function compareStatistics(measurement: Measurement, recorded: RecordedStatistics | null): Comparison {
  if (measurement.status === 'failed') return { status: 'failed', reason: measurement.reason }

  if (recorded === null) return { status: 'unrecorded' }
  const differences: string[] = []

  if (measurement.detectedStars !== recorded.detectedStars)
    differences.push(`stars ${measurement.detectedStars} vs recorded ${recorded.detectedStars}`)
  const measured = measurement.medianHfrPixels
  const was = recorded.medianHfrPixels
  let hfrDifferencePixels: number | null = null

  if (measured === null || was === null) {
    if (measured !== was) differences.push(`HFR ${format(measured)} vs recorded ${format(was)}`)
  } else if (Math.abs(measured - was) > hfrTolerancePixels) {
    hfrDifferencePixels = Math.abs(measured - was)
    differences.push(`HFR ${format(measured)} vs recorded ${format(was)}`)
  }

  if (differences.length === 0) return { status: 'match' }

  return { status: 'differ', differences, hfrDifferencePixels }
}

function format(hfr: number | null) {
  return hfr === null ? 'none' : hfr.toFixed(4)
}
