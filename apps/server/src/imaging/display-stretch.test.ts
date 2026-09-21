import { setImmediate } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { createDisplayStretch } from './display-stretch.js'

// Preserve the original display formula as the oracle: reuse must not introduce
// quantization or interpolation before the final rounding to a display byte.
function originalStretch(sample: number, blackPoint: number, ceiling: number) {
  const value = Math.max(0, (sample - blackPoint) / (ceiling - blackPoint))

  return Math.min(255, Math.round((255 * Math.asinh(value * 10)) / Math.asinh(10)))
}

describe('display stretch', () => {
  it.each([
    [0, 4096],
    [-1024, 2048],
    [-19.17, 1000.13],
  ])(
    'matches the original curve exactly across quarter-step samples from %s to %s',
    async (blackPoint, ceiling) => {
      const stretch = await createDisplayStretch(blackPoint, ceiling)
      const first = Math.floor(blackPoint * 4) - 4

      const samples = Array.from(
        { length: Math.ceil(ceiling * 4) - first + 5 },
        (_, index) => (first + index) / 4,
      )

      expect(samples.map(stretch)).toEqual(
        samples.map(sample => originalStretch(sample, blackPoint, ceiling)),
      )
    },
  )

  it('preserves fractional border averages, arbitrary fractions, clipping, and signed acquisition extremes', async () => {
    const blackPoint = -3.13
    const ceiling = 2048.19
    const stretch = await createDisplayStretch(blackPoint, ceiling)

    const samples = [
      -2147483648,
      -70001,
      -4,
      blackPoint - 0.001,
      blackPoint,
      blackPoint + 0.001,
      0.01,
      0.1,
      0.3,
      0.7,
      1 / 3,
      2 / 3,
      11 / 3,
      6553 / 3,
      10.123456789,
      1023.999999,
      ceiling - 0.001,
      ceiling,
      ceiling + 0.001,
      65536,
      70003,
      2147483647,
    ]

    // Every third-step border average in the visible range, including values
    // between table entries, must retain the original calculation.
    for (let numerator = -12; numerator < 6145; numerator++) samples.push(numerator / 3)
    expect(samples.map(stretch)).toEqual(
      samples.map(sample => originalStretch(sample, blackPoint, ceiling)),
    )
    expect(stretch(-2147483648)).toBe(0)
    expect(stretch(2147483647)).toBe(255)
  })

  it('retains exact results when the acquisition range is too wide for reuse', async () => {
    const blackPoint = -2147483648
    const ceiling = 2147483647
    const stretch = await createDisplayStretch(blackPoint, ceiling)

    const samples = Array.from(
      { length: 4097 },
      (_, index) => blackPoint + (index * (ceiling - blackPoint)) / 4096,
    )

    samples.push(-70001, -1, 0, 1 / 3, 65536, 70003, ceiling + 1)
    expect(samples.map(stretch)).toEqual(
      samples.map(sample => originalStretch(sample, blackPoint, ceiling)),
    )
  })

  it('allows other work to run while preparing a full sensor range', async () => {
    let finished = false

    const preparation = createDisplayStretch(0, 65535).then(stretch => {
      finished = true

      return stretch
    })

    await setImmediate()
    const finishedBeforeOtherWork = finished
    const stretch = await preparation
    expect(finishedBeforeOtherWork).toBe(false)
    expect(stretch(32767.75)).toBe(originalStretch(32767.75, 0, 65535))
  })
})
