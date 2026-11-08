import { describe, expect, it } from 'vitest'
import { syntheticFits } from '../testing/fits.ts'
import { decodePng } from '../testing/png.ts'
import { makePreview } from './preview.ts'

const settings = { bin: 1, blackSigmas: 2.8, targetMedian: 0.25 }

const noise = (x: number, y: number) => ((x * 7 + y * 13) % 5) * 20

function colourFrame(pattern: string, rowOrder?: 'TOP-DOWN') {
  const colourOf = (x: number, y: number) => pattern[(y & 1) * 2 + (x & 1)]

  return syntheticFits({
    width: 16,
    height: 16,
    pattern,
    ...(rowOrder === undefined ? {} : { rowOrder }),
    pixel: (x, y) => 1000 + noise(x, y) + (x < 8 && y < 8 && colourOf(x, y) === 'R' ? 30000 : 0),
  })
}

function superpixel(png: ReturnType<typeof decodePng>, x: number, y: number) {
  const at = (y * png.width + x) * 3

  return [png.rgb[at] ?? 0, png.rgb[at + 1] ?? 0, png.rgb[at + 2] ?? 0]
}

describe('makePreview', () => {
  it('makes one colour pixel from each 2x2 cell, half the size on each side', () => {
    const png = decodePng(makePreview(colourFrame('RGGB', 'TOP-DOWN'), settings))

    expect(png.width).toBe(8)
    expect(png.height).toBe(8)
  })

  it('puts the bright red patch in the red channel where the pattern says red is', () => {
    const png = decodePng(makePreview(colourFrame('RGGB', 'TOP-DOWN'), settings))
    const [red, green, blue] = superpixel(png, 1, 1)

    expect(red).toBeGreaterThan(200)
    expect(green).toBeLessThan(120)
    expect(blue).toBeLessThan(120)
  })

  it('reads the pattern from the header: the same pixels as BGGR put the patch in blue', () => {
    const frame = syntheticFits({
      width: 16,
      height: 16,
      pattern: 'BGGR',
      rowOrder: 'TOP-DOWN',
      pixel: (x, y) => 1000 + noise(x, y) + (x < 8 && y < 8 && (y & 1) === 0 && (x & 1) === 0 ? 30000 : 0),
    })
    const [red, , blue] = superpixel(decodePng(makePreview(frame, settings)), 1, 1)

    expect(blue).toBeGreaterThan(200)
    expect(red).toBeLessThan(120)
  })

  it('stretches every colour so its median lands at the target brightness', () => {
    const png = decodePng(makePreview(colourFrame('RGGB', 'TOP-DOWN'), settings))

    for (const channel of [0, 1, 2]) {
      const levels = Array.from({ length: png.width * png.height }, (_, index) => png.rgb[index * 3 + channel] ?? 0).sort((a, b) => a - b)

      expect(Math.abs((levels[levels.length / 2] ?? 0) / 255 - 0.25)).toBeLessThan(0.05)
    }
  })

  it('shows the last stored row at the top unless the frame says it is stored top-down', () => {
    const bottomUp = decodePng(makePreview(colourFrame('RGGB'), settings))
    const topDown = decodePng(makePreview(colourFrame('RGGB', 'TOP-DOWN'), settings))

    expect(superpixel(topDown, 1, 1)[0]).toBeGreaterThan(200)
    expect(superpixel(bottomUp, 1, 6)[0]).toBeGreaterThan(200)
    expect(superpixel(bottomUp, 1, 1)[0]).toBeLessThan(200)
  })

  it('averages superpixels when asked to bin', () => {
    const png = decodePng(makePreview(colourFrame('RGGB', 'TOP-DOWN'), { ...settings, bin: 2 }))

    expect(png.width).toBe(4)
    expect(png.height).toBe(4)
  })

  it('refuses a frame without a Bayer pattern', () => {
    expect(() => makePreview(syntheticFits({ width: 4, height: 4, pixel: () => 100 }), settings)).toThrow('Bayer')
  })
})
