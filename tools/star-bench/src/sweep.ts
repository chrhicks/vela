import type { FrameAlertId, ReplayOptions } from './alerts.ts'
import { assessNight, passedFor } from './assess.ts'
import type { NightLabels } from './labels.ts'
import type { Run } from './runs.ts'

/**
 * A threshold whose range the bench measures, and the values it tries. Only the alert it governs is
 * judged, so another alert's miss on a night does not hide how far this threshold can move.
 */
export interface SweepSpec {
  threshold: 'starsDropFraction' | 'starsCollapsedRatio' | 'starsDecliningRatio'
  alert: FrameAlertId
  from: number
  to: number
  step: number
}

export const sweeps: SweepSpec[] = [
  { threshold: 'starsDropFraction', alert: 'stars-dropping', from: 0.05, to: 0.95, step: 0.01 },
  { threshold: 'starsCollapsedRatio', alert: 'stars-collapsed', from: 0.01, to: 0.6, step: 0.01 },
  { threshold: 'starsDecliningRatio', alert: 'stars-declining', from: 0.3, to: 0.95, step: 0.01 },
]

/**
 * The run of neighbouring values at which every labelled expectation of those nights holds. It is
 * the run around the default, or the longest run when the default fails.
 */
export interface SweepRange {
  lowest: number
  highest: number
  /** The run reaches the edge of the values tried instead of stopping at a failure. */
  openBelow: boolean
  openAbove: boolean
  /** The default lies inside the run. */
  holdsAtDefault: boolean
}

export interface SweepResult {
  threshold: SweepSpec['threshold']
  default: number
  /** Null when no value passes. */
  calibration: SweepRange | null
  holdout: SweepRange | null
  /** Where the two overlap: a value in it passes the nights it was picked on and the nights held out. */
  both: SweepRange | null
}

export function sweepThreshold(nights: NightLabels[], runs: Run[], spec: SweepSpec, options: ReplayOptions): SweepResult {
  const defaultValue = options.thresholds[spec.threshold]
  const steps = Math.round((spec.to - spec.from) / spec.step)
  const valueAt = (index: number) => Number((spec.from + index * spec.step).toFixed(6))

  const range = (use: NightLabels['use']): SweepRange | null => {
    const chosen = nights.filter(night => night.use === use)

    const passes = Array.from({ length: steps + 1 }, (_, index) =>
      chosen.every(night =>
        passedFor(
          assessNight(night, runs, { ...options, thresholds: { ...options.thresholds, [spec.threshold]: valueAt(index) } }),
          spec.alert,
        ),
      ),
    )

    let best: { low: number; high: number } | null = null

    for (let low = 0; low <= steps; low++) {
      if (!passes[low]) continue
      let high = low

      while (high < steps && passes[high + 1]) high++

      const holdsDefault = valueAt(low) <= defaultValue && defaultValue <= valueAt(high)

      if (holdsDefault || best === null || high - low > best.high - best.low) best = { low, high }

      if (holdsDefault) break
      low = high
    }

    if (!best) return null

    return {
      lowest: valueAt(best.low),
      highest: valueAt(best.high),
      openBelow: best.low === 0,
      openAbove: best.high === steps,
      holdsAtDefault: valueAt(best.low) <= defaultValue && defaultValue <= valueAt(best.high),
    }
  }

  const calibration = range('calibration')
  const holdout = range('holdout')

  return { threshold: spec.threshold, default: defaultValue, calibration, holdout, both: overlap(calibration, holdout, defaultValue) }
}

function overlap(first: SweepRange | null, second: SweepRange | null, defaultValue: number): SweepRange | null {
  if (!first || !second) return null
  const lowest = Math.max(first.lowest, second.lowest)
  const highest = Math.min(first.highest, second.highest)

  if (lowest > highest) return null

  return {
    lowest,
    highest,
    openBelow: lowest === first.lowest ? first.openBelow : second.openBelow,
    openAbove: highest === first.highest ? first.openAbove : second.openAbove,
    holdsAtDefault: lowest <= defaultValue && defaultValue <= highest,
  }
}
