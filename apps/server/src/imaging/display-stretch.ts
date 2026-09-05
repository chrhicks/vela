import { setImmediate } from 'node:timers/promises'

/** The existing asinh display curve, with exact reuse of common sensor values. */
export async function createDisplayStretch(blackPoint: number, ceiling: number) {
  const denominator = Math.asinh(10)
  const transfer = (sample: number) => {
    const value = Math.max(0, (sample - blackPoint) / (ceiling - blackPoint))
    return Math.min(255, Math.round(255 * Math.asinh(value * 10) / denominator))
  }
  // Integer sensor samples and interior bilinear averages land on quarter steps.
  // These are exact values, not interpolation of the display curve. Unusual sample
  // ranges and fractional border averages still use the original calculation.
  const first = Math.ceil(blackPoint * 4)
  const size = Math.floor(ceiling * 4) - first + 1
  const table = ceiling > blackPoint && Number.isSafeInteger(first) && Number.isSafeInteger(size) && size > 0 && size <= 262_144
    ? new Uint8Array(size) : null
  if (table) {
    for (let index = 0; index < table.length; index++) {
      if (index % 16_384 === 0) await setImmediate()
      table[index] = transfer((first + index) / 4)
    }
  }
  return (sample: number) => {
    const index = sample * 4 - first
    return table && Number.isInteger(index) && index >= 0 && index < table.length ? table[index]! : transfer(sample)
  }
}
