import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { capturePreviews, previewPng, type ImageColor } from './preview.js'

function decode(png: Buffer) {
  const chunks: Buffer[] = []

  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset)

    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT')
      chunks.push(png.subarray(offset + 8, offset + 8 + length))
    offset += length + 12
  }

  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
    colorType: png[25],
    pixels: inflateSync(Buffer.concat(chunks)),
  }
}

describe('native image preview', () => {
  it('keeps native pixels and averages a smaller fitted preview without dropping narrow stars', async () => {
    const pixels = new Float64Array(1602 * 2)
    pixels[1] = 1000
    pixels[pixels.length - 1] = 1000
    const result = await capturePreviews(1602, 2, pixels)
    const native = decode(result.native)
    const fit = decode(result.fit!)
    expect(native).toMatchObject({ width: 1602, height: 2 })
    expect(fit).toMatchObject({ width: 801, height: 1 })
    expect(fit.pixels[1]).toBe(64)
    expect(fit.pixels.at(-1)).toBe(64)
    expect((await capturePreviews(2, 2, [0, 1, 2, 3])).fit).toBeUndefined()
  })
  it('preserves the acquisition samples while producing a native monochrome stretch', async () => {
    const pixels = Float64Array.from([0, 10, 100, 1000, 2000, 4000])
    const before = pixels.slice()
    const image = decode(await previewPng(3, 2, pixels))
    expect(image).toMatchObject({ width: 3, height: 2, colorType: 0 })
    expect(image.pixels).toHaveLength(8)
    expect(image.pixels[7]).toBeGreaterThan(image.pixels[6]!)
    expect(pixels).toEqual(before)
  })

  it('normalizes all Bayer phases into the same RGB colors, including borders and corners', async () => {
    const patterns = ['rggb', 'grbg', 'gbrg', 'bggr'] as const
    let expected: Buffer | undefined

    for (const pattern of patterns) {
      // SAFETY: all patterns contain four r/g/b characters and parity indexes stay within 0–3.
      const pixels = Float64Array.from(
        { length: 64 },
        (_, i) =>
          ({ r: 900, g: 300, b: 1200 })[
            pattern[(Math.floor(i / 8) % 2) * 2 + (i % 2)] as 'r' | 'g' | 'b'
          ],
      )

      const before = pixels.slice()
      const color: ImageColor = { kind: 'bayer', pattern }
      const image = decode(await previewPng(8, 8, pixels, color))
      expect(image).toMatchObject({ width: 8, height: 8, colorType: 2 })
      expect(image.pixels).toHaveLength(8 * 25)
      expected ??= image.pixels
      expect(image.pixels).toEqual(expected)
      const first = image.pixels.subarray(1, 4)
      expect(first[0]).toBeGreaterThan(first[1]!)
      expect(first[2]).toBeGreaterThan(first[0]!)

      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          expect(image.pixels.subarray(y * 25 + x * 3 + 1, y * 25 + x * 3 + 4)).toEqual(first)
        }
      }

      expect(pixels).toEqual(before)
    }
  })
})
