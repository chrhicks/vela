import { describe, expect, it } from 'vitest'
import { bayerPixel, type BayerPattern } from './bayer.js'

const patterns: BayerPattern[] = ['rggb', 'grbg', 'gbrg', 'bggr']

// Preserve the pre-optimization neighborhood algorithm as an independent oracle.
// Its traversal, in-frame averaging, and absent-channel fallback define the pixels
// the faster phase-specific implementation must continue to produce exactly.
function originalBayerPixel(width: number, height: number, pixels: ArrayLike<number>, pattern: BayerPattern, x: number, y: number) {
  const values = [0, 0, 0]
  const counts = [0, 0, 0]
  const channelAt = (px: number, py: number) => 'rgb'.indexOf(pattern[(py % 2) * 2 + px % 2]!)
  const ownChannel = channelAt(x, y)
  values[ownChannel] = pixels[y * width + x]!
  counts[ownChannel] = 1
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const px = x + dx, py = y + dy
      if (px < 0 || py < 0 || px >= width || py >= height) continue
      const channel = channelAt(px, py)
      if (channel === ownChannel) continue
      values[channel]! += pixels[py * width + px]!
      counts[channel]!++
    }
  }
  return values.map((value, channel) => counts[channel] ? value / counts[channel]! : pixels[y * width + x]!)
}

describe('Bayer interpolation', () => {
  it.each(patterns)('preserves every pixel of the original %s interpolation across sensor phases and frame edges', (pattern) => {
    // Width/height 1 exercise absent colors; 2 covers frames with no interior;
    // larger odd/even frames exercise all four interior phases and edge phases.
    const dimensions = [1, 2, 3, 4, 7, 8]
    const sampleSets = [
      [0, 1, 7, 256, 1023, 32768, 65535, 912],
      [-2147483648, 2147483647, -70001, 70003, -1, 0, 65536, 1073741824],
    ]
    for (const width of dimensions) for (const height of dimensions) {
      for (const samples of sampleSets) {
        const pixels = Int32Array.from({ length: width * height }, (_, index) => samples[(index * 5 + Math.floor(index / width) * 3) % samples.length]!)
        const before = pixels.slice()
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          expect(bayerPixel(width, height, pixels, pattern, x, y), `${width}x${height} at (${x}, ${y})`)
            .toEqual(originalBayerPixel(width, height, pixels, pattern, x, y))
        }
        expect(pixels).toEqual(before)
      }
    }
  })

  it('averages only available neighbors and uses the original sample when a color is absent', () => {
    expect(bayerPixel(2, 2, [1, 2, 4, 8], 'rggb', 0, 0)).toEqual([1, 3, 8])
    expect(bayerPixel(3, 1, [10, 21, 40], 'rggb', 1, 0)).toEqual([25, 21, 21])
    expect(bayerPixel(1, 3, [10, 21, 40], 'bggr', 0, 1)).toEqual([21, 21, 25])
    for (const pattern of patterns) {
      expect(bayerPixel(1, 1, [-70001], pattern, 0, 0)).toEqual([-70001, -70001, -70001])
    }
  })
})
