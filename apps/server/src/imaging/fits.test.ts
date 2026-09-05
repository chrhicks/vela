import { describe, expect, it } from 'vitest'
import { encodeCaptureFits } from './fits.js'

const metadata = { exposureSeconds: 1.5, cameraName: "Chris's camera" }
const frame = { width: 3, height: 2, pixels: [-2_147_483_648, -1, 0, 1, 65535, 2_147_483_647], capturedAt: '2026-09-05T19:00:00-04:00' }
function header(buffer: Buffer) { return buffer.subarray(0, 2880).toString('ascii').match(/.{80}/g)! }

describe('original capture FITS', () => {
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
    const fits = await encodeCaptureFits({ ...frame, color: { kind: 'bayer', pattern } }, metadata)
    expect(header(fits)).toContain(`BAYERPAT= '${pattern.toUpperCase()}'`.padEnd(80))
  })

  it('keeps long camera labels on one card and rejects lossy pixel conversion', async () => {
    const fits = await encodeCaptureFits(frame, { ...metadata, cameraName: "é'".repeat(100) })
    expect(header(fits).find(card => card.startsWith('INSTRUME'))!.trimEnd().endsWith("'")).toBe(true)
    expect(header(fits)).toContain("ROWORDER= 'TOP-DOWN'".padEnd(80))
    for (const value of [NaN, 0.1, 2_147_483_648, -2_147_483_649]) {
      await expect(encodeCaptureFits({ ...frame, pixels: [value, 0, 0, 0, 0, 0] }, metadata)).rejects.toThrow('signed 32-bit')
    }
    await expect(encodeCaptureFits({ ...frame, width: 4 }, metadata)).rejects.toThrow('dimensions')
  })

  it('yields before a large frame is completely encoded', async () => {
    let observed = false
    const tick = new Promise<void>(resolve => setImmediate(() => {
      observed = true
      resolve()
    }))
    const pending = encodeCaptureFits({ ...frame, width: 1024, height: 1024, pixels: new Int32Array(1024 * 1024) }, metadata)
    await tick
    expect(observed).toBe(true)
    let complete = false
    void pending.then(() => { complete = true })
    await Promise.resolve()
    expect(complete).toBe(false)
    await pending
  })
})
