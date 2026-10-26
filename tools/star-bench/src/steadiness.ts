/** A pair of neighbouring frames counts as a jump when the count changes by more than this factor. */
export const jumpFactor = 1.5

export interface Steadiness {
  pairs: number
  jumps: number
  /** Robust spread (1.4826 x MAD) of log(count / previous count). Lower is steadier. */
  spread: number | null
}

/** How much a frame-to-frame star count moves, the way the 2026-10-25 review measured it. */
export function steadiness(counts: number[]): Steadiness {
  const logRatios: number[] = []

  for (let index = 1; index < counts.length; index++)
    logRatios.push(Math.log(Math.max(counts[index]!, 1) / Math.max(counts[index - 1]!, 1)))

  if (logRatios.length === 0) return { pairs: 0, jumps: 0, spread: null }
  const centre = median(logRatios)

  return {
    pairs: logRatios.length,
    jumps: logRatios.filter(ratio => Math.abs(ratio) > Math.log(jumpFactor)).length,
    spread: 1.4826 * median(logRatios.map(ratio => Math.abs(ratio - centre))),
  }
}

export function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}
