import type { FocuserTravel } from './walk.js'

/** One sweep of the focuser: `offsetSteps` steps of `stepSize` on each side of a centre. */
export interface PassSettings {
  stepSize: number
  offsetSteps: number
}

export interface MeasuredPosition {
  position: number
  hfrPixels: number | null
}

/** What a pass does next, read only from the positions it has sampled so far. */
export type PassNext =
  | { kind: 'sample'; position: number }
  | { kind: 'closed'; lowest: number }
  | { kind: 'no-stars' }
  | { kind: 'travel-limit'; edge: 'low' | 'high'; lowest: number }

/** The planned positions, top first, because every sample follows a downward move. Anything outside travel is left out. */
export function planPass(centre: number, { stepSize, offsetSteps }: PassSettings, travel: FocuserTravel) {
  const positions: number[] = []

  for (let step = offsetSteps; step >= -offsetSteps; step--) {
    const position = centre + step * stepSize

    if (position >= travel.min && position <= travel.max) positions.push(position)
  }

  return positions
}

/**
 * Samples every planned position, then looks at the lowest HFR. A pass is closed when that sample has
 * a sampled position on both sides of it, so HFR rose away from it either way. When it sits at an
 * edge the window moves one step that way, toward the lower HFR, up to the focuser travel. A
 * sample with no stars counts as worse than any measured one. No edge minimum fails a pass; only
 * running out of travel, or having measured nothing, does.
 */
export function nextInPass(
  planned: number[],
  stepSize: number,
  travel: FocuserTravel,
  samples: MeasuredPosition[],
): PassNext {
  const sampled = new Set(samples.map(sample => sample.position))
  const unsampled = planned.find(position => !sampled.has(position))

  if (unsampled !== undefined) return { kind: 'sample', position: unsampled }

  const lowest = lowestMeasured(samples)

  if (!lowest) return { kind: 'no-stars' }

  const positions = samples.map(sample => sample.position)
  const lowEdge = Math.min(...positions)
  const highEdge = Math.max(...positions)

  if (lowest.position === lowEdge) {
    const next = lowEdge - stepSize

    return next < travel.min
      ? { kind: 'travel-limit', edge: 'low', lowest: lowest.position }
      : { kind: 'sample', position: next }
  }

  if (lowest.position === highEdge) {
    const next = highEdge + stepSize

    return next > travel.max
      ? { kind: 'travel-limit', edge: 'high', lowest: lowest.position }
      : { kind: 'sample', position: next }
  }

  return { kind: 'closed', lowest: lowest.position }
}

/** The position and HFR of the measured sample with the lowest HFR. The first one measured wins a tie. */
export function lowestMeasured(samples: MeasuredPosition[]) {
  let lowest: { position: number; hfrPixels: number } | undefined

  for (const sample of samples) {
    if (sample.hfrPixels === null) continue

    if (!lowest || sample.hfrPixels < lowest.hfrPixels)
      lowest = { position: sample.position, hfrPixels: sample.hfrPixels }
  }

  return lowest
}
