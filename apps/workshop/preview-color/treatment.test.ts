import { describe, expect, it } from 'vitest'
import { inflateSync } from 'node:zlib'
import { backgroundOffsets, linkedRange, neutralPreviews, type PreviewFrame } from './treatment.js'
import { capturePreviews } from '../../server/src/imaging/preview.js'
import { encodeCaptureFits } from '../../server/src/imaging/fits.js'
import { readFrame } from './read-frame.js'
import type { BayerPattern } from '../../server/src/imaging/bayer.js'

function frame(pattern: BayerPattern = 'rggb'): PreviewFrame {
  const width = 128, height = 128
  const pixels = new Int32Array(width * height)

  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const channel = pattern[y % 2 * 2 + x % 2]!
    const background = new Map([['r', 510], ['g', 530], ['b', 500]]).get(channel)!
    const redNebula = x > 70 && y > 30 && channel === 'r' ? 800 : 0
    const blueSource = x > 70 && y < 30 && channel === 'b' ? 800 : 0
    pixels[y * width + x] = background + redNebula + blueSource + Math.floor(x / 16)
  }

  return { width, height, pixels, color: { kind: 'bayer', pattern } }
}

// The encoder uses PNG filter 0. Decode IDAT independently of the renderer.
function pngPixels(png: Buffer) {
  const idat = []

  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset)

    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') idat.push(png.subarray(offset + 8, offset + 8 + length))
    offset += length + 12
  }

  return inflateSync(Buffer.concat(idat))
}

describe('workshop-only background treatment', () => {
  it.each<BayerPattern>(['rggb', 'grbg', 'gbrg', 'bggr'])('removes additive tint without balancing away red and blue sources (%s)', async pattern => {
    const input = frame(pattern)
    const before = Array.from(input.pixels)
    const result = await neutralPreviews(input)
    expect(result.estimate.offsets).toEqual([10, 30, 0])
    const displayed = pngPixels(result.native)
    const rgbAt = (x: number, y: number) => [...displayed.subarray(y * (128 * 3 + 1) + x * 3 + 1, y * (128 * 3 + 1) + x * 3 + 4)]
    expect(new Set(rgbAt(20, 20)).size).toBe(1)
    const nebula = rgbAt(100, 100)
    expect(nebula[0]! - nebula[1]!).toBeGreaterThan(150)
    const blue = rgbAt(100, 20)
    expect(blue[2]! - blue[1]!).toBeGreaterThan(150)
    expect(rgbAt(0, 0)).toEqual([0, 0, 0])
    expect(Array.from(input.pixels)).toEqual(before)
  })

  it('bounds a field-filling color rather than declaring its mean neutral', () => {
    const input = frame()
    const result = backgroundOffsets(input, { black: 500, ceiling: 600 })
    expect(result.offsets).toEqual([10, 10, 0])
    expect(result.status).toContain('Bound reached')
  })

  it('leaves mono, blank and invalid-background estimates explicit', async () => {
    const pixels = new Int32Array(64 * 64).fill(510)
    const mono: PreviewFrame = { width: 64, height: 64, pixels, color: { kind: 'mono' } }
    const result = await neutralPreviews(mono)
    const baseline = await capturePreviews(64, 64, pixels)
    expect(result.native.equals(baseline.native)).toBe(true)
    expect(result.estimate.status).toContain('mono')
    const blank: PreviewFrame = { ...mono, color: { kind: 'bayer', pattern: 'rggb' } }
    expect(backgroundOffsets(blank, linkedRange(pixels)).offsets).toEqual([0, 0, 0])
    expect(backgroundOffsets({ ...blank, pixels: new Float64Array(pixels.length).fill(NaN) }, { black: 0, ceiling: 100 }).status).toContain('invalid')
  })

  it('averages the same displayed pixels for fitted derivatives', async () => {
    const input: PreviewFrame = { width: 1601, height: 2, pixels: Int32Array.from({ length: 3202 }, (_, i) => i % 1000), color: { kind: 'mono' } }
    const result = await neutralPreviews(input)
    const native = pngPixels(result.native), fit = pngPixels(result.fit)
    expect(fit[1]).toBe(Math.round((native[1]! + native[2]! + native[1603]! + native[1604]!) / 4))
    expect(fit[801]).toBe(Math.round((native[1601]! + native[3203]!) / 2))
  })

  it('reads signed32 samples without flipping or rescaling, rejecting other formats and truncation', async () => {
    const input = frame('bggr')
    const signedPixels = Int32Array.from(input.pixels)
    signedPixels[0] = -1
    input.pixels = signedPixels
    const fits = await encodeCaptureFits({ ...input, capturedAt: '2026-09-15T03:00:00Z' }, { exposureSeconds: 180, cameraName: 'fixture' })
    const decoded = readFrame(fits)
    expect(decoded).toEqual(input)
    expect(() => readFrame(fits.subarray(0, fits.length - 1))).toThrow('payload length')
    const unsupported = Buffer.from(fits)
    unsupported.write('16', 80 + 28)
    expect(() => readFrame(unsupported)).toThrow('signed32')
  })
})
