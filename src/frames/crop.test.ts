import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import { syntheticFits } from '../testing/fits.ts'
import { decodePng } from '../testing/png.ts'
import { cropOf, develop } from './crop.ts'
import { makePreview } from './preview.ts'

const settings = { bin: 1, blackSigmas: 2.8, targetMedian: 0.25 }

const noise = (x: number, y: number) => ((x * 7 + y * 13) % 5) * 20

function frame(rowOrder?: 'TOP-DOWN') {
  const colourOf = (x: number, y: number) => 'RGGB'[(y & 1) * 2 + (x & 1)]

  return syntheticFits({
    width: 16,
    height: 16,
    pattern: 'RGGB',
    ...(rowOrder === undefined ? {} : { rowOrder }),
    pixel: (x, y) => 1000 + noise(x, y) + (x < 8 && y < 4 && colourOf(x, y) === 'R' ? 30000 : 0),
  })
}

const cut = (bytes: Buffer, box: { x: number; y: number; width: number; height: number }) => {
  const png = Result.getOrThrow(cropOf(develop(bytes, settings), box))
  const { width, height, rgb } = decodePng(png)

  return { width, height, at: (x: number, y: number) => [rgb[(y * width + x) * 3]!, rgb[(y * width + x) * 3 + 1]!, rgb[(y * width + x) * 3 + 2]!] }
}

describe('a crop of a frame at full size', () => {
  it('is one picture pixel for each camera pixel of the box asked', () => {
    const crop = cut(frame('TOP-DOWN'), { x: 2, y: 1, width: 9, height: 5 })

    expect([crop.width, crop.height]).toEqual([9, 5])
  })

  it('gives every pixel all three colours, red only where the camera saw red', () => {
    const crop = cut(frame('TOP-DOWN'), { x: 0, y: 0, width: 16, height: 16 })
    const [red, green, blue] = crop.at(3, 2)
    const [farRed] = crop.at(12, 12)

    expect(red).toBeGreaterThan(200)
    expect(green).toBeLessThan(120)
    expect(blue).toBeLessThan(120)
    expect(farRed).toBeLessThan(120)
  })

  it('shows the frame the same way up as its preview, whichever row the file starts with', () => {
    const bottomUp = frame()
    const crop = cut(bottomUp, { x: 0, y: 0, width: 16, height: 16 })
    const preview = decodePng(makePreview(bottomUp, settings))
    const previewRedAtTop = preview.rgb[(1 * preview.width + 1) * 3]!
    const previewRedAtBottom = preview.rgb[(6 * preview.width + 1) * 3]!

    expect(crop.at(3, 2)[0]! > 200).toBe(previewRedAtTop > 200)
    expect(crop.at(3, 13)[0]! > 200).toBe(previewRedAtBottom > 200)
    expect(previewRedAtTop > 200).not.toBe(previewRedAtBottom > 200)
  })

  it('refuses a box that is not whole pixels inside the frame', () => {
    const developed = develop(frame('TOP-DOWN'), settings)

    expect(Result.isFailure(cropOf(developed, { x: 10, y: 0, width: 8, height: 4 }))).toBe(true)
    expect(Result.isFailure(cropOf(developed, { x: 0.5, y: 0, width: 4, height: 4 }))).toBe(true)
    expect(Result.isFailure(cropOf(developed, { x: 0, y: 0, width: 0, height: 4 }))).toBe(true)
  })
})
