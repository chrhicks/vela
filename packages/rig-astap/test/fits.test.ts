import { describe, expect, it } from 'vitest'
import { readFits, writeFits } from '@vela/rig-astap'
import { frame } from './support.ts'

describe('FITS round trip', () => {
  it('reads back the unsigned 16-bit samples, size, time and Bayer pattern it wrote', () => {
    const written = frame()
    const read = readFits(writeFits(written))

    expect(read.ok).toBe(true)

    if (read.ok) {
      expect(read.frame.width).toBe(64)
      expect(read.frame.height).toBe(48)
      expect(read.frame.color).toEqual({ kind: 'bayer', pattern: 'rggb' })
      expect(read.frame.capturedAt).toBe('2026-10-26T23:38:36.936Z')
      expect(read.frame.exposureSeconds).toBe(2)
      expect(Array.from(read.frame.pixels)).toEqual(Array.from(written.pixels))
    }
  })

  it('writes signed 32-bit samples when a value does not fit 16 bits unsigned, and reads them back', () => {
    const pixels = new Int32Array(64 * 48).map((_, index) => index - 100_000)
    const read = readFits(writeFits(frame({ pixels, color: { kind: 'mono' } })))

    expect(read.ok && read.frame.color).toEqual({ kind: 'mono' })
    expect(read.ok && Array.from(read.frame.pixels)).toEqual(Array.from(pixels))
  })

  it('pads the header and the data to whole 2880-byte blocks', () => {
    expect(writeFits(frame()).length % 2880).toBe(0)
  })

  it('refuses a file that ends before its last sample', () => {
    const bytes = writeFits(frame())
    const read = readFits(bytes.subarray(0, 2880 + 100))

    expect(read).toEqual({ ok: false, reason: 'the file ends before the last sample' })
  })

  it('refuses rows that are not top-down, a missing time and a sample format it does not read', () => {
    const text = (bytes: Uint8Array) => new TextDecoder('ascii').decode(bytes)
    const swap = (from: string, to: string) => new TextEncoder().encode(text(writeFits(frame())).replace(from, to))

    expect(readFits(swap("'TOP-DOWN'", "'BOTTOMUP'"))).toMatchObject({ ok: false, reason: 'rows are not top-down' })
    expect(readFits(swap('DATE-OBS', 'DATE-XXX'))).toMatchObject({ ok: false, reason: 'no valid DATE-OBS' })
    expect(readFits(swap('BITPIX  =                   16', 'BITPIX  =                  -32'))).toMatchObject({ ok: false })
  })

  it('refuses bytes that are not FITS', () => {
    expect(readFits(new TextEncoder().encode('not a fits file'))).toMatchObject({ ok: false })
  })
})
