import { describe, expect, it } from 'vitest'
import { encodeCaptureFits } from './fits.js'

const metadata = { exposureSeconds: 1.5, cameraName: "Chris's camera" }

const frame = { width: 3, height: 2, pixels: [-2_147_483_648, -1, 0, 1, 65535, 2_147_483_647], capturedAt: '2026-09-05T19:00:00-04:00' }

function header(buffer: Buffer) { return buffer.subarray(0, 2880).toString('ascii').match(/.{80}/g)! }

describe('original capture FITS', () => {
  it('stores every unsigned 16-bit value losslessly without changing acquisition samples', async () => {
    const pixels = Int32Array.from({ length: 65_536 }, (_, i) => i)
    const original = pixels.slice()
    const fits = await encodeCaptureFits({ ...frame, width: 256, height: 256, pixels }, metadata)
    const cards = header(fits)
    expect(cards[1]).toBe('BITPIX  =                   16'.padEnd(80))
    expect(cards).toContain('BZERO   =                32768'.padEnd(80))
    expect(cards).toContain('BSCALE  =                    1'.padEnd(80))
    expect(Array.from({ length: pixels.length }, (_, i) => fits.readInt16BE(2880 + i * 2) + 32_768)).toEqual(Array.from(original))
    expect(pixels).toEqual(original)
    expect(fits.subarray(2880, 2884).toString('hex')).toBe('80008001')
    expect(fits.subarray(2880 + 32_767 * 2, 2880 + 32_769 * 2).toString('hex')).toBe('ffff0000')
    expect(fits.readInt16BE(2880 + 65_535 * 2)).toBe(32_767)
    expect(fits.length).toBe(2880 + Math.ceil(pixels.length * 2 / 2880) * 2880)
    expect(fits.subarray(2880 + pixels.length * 2).every(value => value === 0)).toBe(true)
    expect(cards.slice(cards.indexOf('END'.padEnd(80)) + 1).every(card => card.trim() === '')).toBe(true)
  })

  it.each([-1, 65_536])('keeps signed 32-bit storage when a late sample is %s', async value => {
    const pixels = new Int32Array(65_537).fill(32_768)
    pixels[pixels.length - 1] = value
    const original = pixels.slice()
    const fits = await encodeCaptureFits({ ...frame, width: pixels.length, height: 1, pixels }, metadata)
    expect(header(fits)[1]).toBe('BITPIX  =                   32'.padEnd(80))
    expect(header(fits).some(card => /^(BZERO|BSCALE)/.test(card))).toBe(false)
    expect(Array.from({ length: pixels.length }, (_, i) => fits.readInt32BE(2880 + i * 4))).toEqual(Array.from(original))
    expect(pixels).toEqual(original)
  })

  it('preserves signed samples in row order and pads header/data to FITS blocks', async () => {
    const fits = await encodeCaptureFits(frame, metadata)
    expect(fits.length).toBe(5760)
    expect(Array.from({ length: 6 }, (_, i) => fits.readInt32BE(2880 + i * 4))).toEqual(frame.pixels)
    expect(fits.subarray(2880, 2892).toString('hex')).toBe('80000000ffffffff00000000')
    expect(fits.subarray(2904).every(value => value === 0)).toBe(true)
    const cards = header(fits)
    expect(cards[0]).toBe('SIMPLE  =                    T'.padEnd(80))
    expect(cards[1]).toBe('BITPIX  =                   32'.padEnd(80))
    expect(cards).toContain("DATE-OBS= '2026-09-05T23:00:00.000Z'".padEnd(80))
    expect(cards).toContain('EXPTIME =                  1.5'.padEnd(80))
    expect(cards).toContain("INSTRUME= 'Chris''s camera'".padEnd(80))
    expect(cards).toContain("ROWORDER= 'TOP-DOWN'".padEnd(80))
    expect(cards.some(card => card.startsWith('BAYERPAT'))).toBe(false)
    expect(cards.slice(cards.indexOf('END'.padEnd(80)) + 1).every(card => card.trim() === '')).toBe(true)
  })

  it.each(['rggb', 'grbg', 'gbrg', 'bggr'] as const)('writes the acquisition-origin %s pattern without another shift', async pattern => {
    for (const pixels of [frame.pixels, [0, 1, 32_767, 32_768, 65_534, 65_535]]) {
      const fits = await encodeCaptureFits({ ...frame, pixels, color: { kind: 'bayer', pattern } }, metadata)
      expect(header(fits)).toContain(`BAYERPAT= '${pattern.toUpperCase()}'`.padEnd(80))
      expect(header(fits)).toContain("ROWORDER= 'TOP-DOWN'".padEnd(80))
    }
  })

  it('keeps long camera labels on one card and rejects lossy pixel conversion', async () => {
    const fits = await encodeCaptureFits(frame, { ...metadata, cameraName: "é'".repeat(100) })
    expect(header(fits).find(card => card.startsWith('INSTRUME'))!.trimEnd().endsWith("'")).toBe(true)
    expect(header(fits)).toContain("ROWORDER= 'TOP-DOWN'".padEnd(80))

    for (const value of [NaN, Infinity, -Infinity, 0.1, 2_147_483_648, -2_147_483_649]) {
      await expect(encodeCaptureFits({ ...frame, pixels: [value, 0, 0, 0, 0, 0] }, metadata)).rejects.toThrow('signed 32-bit')
    }

    await expect(encodeCaptureFits({ ...frame, width: 4 }, metadata)).rejects.toThrow('dimensions')
  })

  it('validates samples beyond an initial batch and after selecting signed storage', async () => {
    const pixels = new Float64Array(65_537)
    pixels[0] = -1
    pixels[pixels.length - 1] = 0.5
    await expect(encodeCaptureFits({ ...frame, width: pixels.length, height: 1, pixels }, metadata)).rejects.toThrow('signed 32-bit')
  })

  it.each([0, -1])('yields during validation and writing for a large frame containing %s', async value => {
    const pixels = Array.from({ length: 196_608 }, () => value)
    let firstReads = 0
    let lastReads = 0
    let observeWriting: () => void = () => {}

    const writingTick = new Promise<void>(resolve => { observeWriting = resolve })

    Object.defineProperty(pixels, 0, { get() {
      firstReads++

      if (firstReads === 2) setImmediate(observeWriting)

      return value
    } })
    Object.defineProperty(pixels, pixels.length - 1, { get() {
      lastReads++

      return value
    } })
    const validationTick = new Promise<void>(resolve => setImmediate(resolve))
    const pending = encodeCaptureFits({ ...frame, width: 512, height: 384, pixels }, metadata)
    await validationTick
    expect(lastReads).toBe(0)
    await writingTick
    expect(lastReads).toBe(1)
    await pending
    expect(lastReads).toBe(2)
  })
})

it.each([{ pixels: frame.pixels }, { pixels: [0, 1, 32_767, 32_768, 65_534, 65_535] }])('preserves exposure metadata and annotates only estimated starts ($pixels)', async ({ pixels }) => {
  for (const capturedAtSource of [undefined, 'camera', 'server-estimate'] as const) {
    const fits = await encodeCaptureFits({ ...frame, pixels, capturedAtSource }, metadata)
    const header = fits.toString('ascii', 0, 2880)
    expect(header).toContain("DATE-OBS= '2026-09-05T23:00:00.000Z'")
    expect(header).toContain('EXPTIME =                  1.5')
    expect(header).toContain("INSTRUME= 'Chris''s camera'")
    expect(header.includes("TIMESRC = 'SERVER-ESTIMATE'")).toBe(capturedAtSource === 'server-estimate')
    expect(header.includes('COMMENT DATE-OBS estimated from server UTC before StartExposure.')).toBe(capturedAtSource === 'server-estimate')
  }
})
