import { describe, expect, it } from 'vitest'
import { readRetainedFits } from './read-retained-fits.js'

// Independent FITS construction: not the production encoder under test in the other workstream.
function fixture(bitpix: 16 | 32, samples: number[], extra: string[] = []) {
  const card = (key: string, value: string) => `${key.padEnd(8)}= ${value}`.padEnd(80)
  const cards = [card('SIMPLE', 'T'), card('BITPIX', String(bitpix)), card('NAXIS', '2'), card('NAXIS1', '2'), card('NAXIS2', '2'), card('ROWORDER', "'TOP-DOWN'"), card('BAYERPAT', "'GRBG'"), ...extra]

  if (bitpix === 16) cards.push(card('BZERO', '32768'), card('BSCALE', '1'))
  const bytes = Buffer.alloc(5760)
  bytes.fill(32, 0, 2880)
  bytes.write([...cards, 'END'.padEnd(80)].join(''))
  samples.forEach((value, i) => bitpix === 16 ? bytes.writeInt16BE(value - 32768, 2880 + i * 2) : bytes.writeInt32BE(value, 2880 + i * 4))

  return bytes
}

describe('bounded retained Vela FITS reader', () => {
  it.each([16, 32] as const)('decodes BITPIX %s in acquisition ADU and preserves row/Bayer origin', async bitpix => {
    const samples = bitpix === 16 ? [0, 32767, 32768, 65535] : [-2147483648, -1, 65536, 2147483647]
    const bytes = fixture(bitpix, samples)
    const original = Buffer.from(bytes)
    const decoded = await readRetainedFits(bytes)
    expect(Array.from(decoded.pixels)).toEqual(samples)
    expect(decoded).toMatchObject({ width: 2, height: 2, color: { kind: 'bayer', pattern: 'grbg' } })
    expect(bytes).toEqual(original)
  })

  it('rejects scaling ambiguity, duplicate cards, other encodings and malformed payloads', async () => {
    const signed = fixture(32, [0, 1, 2, 3])
    const scaled = fixture(32, [0, 1, 2, 3], ["BZERO   = 32768".padEnd(80)])
    await expect(readRetainedFits(scaled)).rejects.toThrow('Unsupported')
    await expect(readRetainedFits(fixture(32, [0, 1, 2, 3], ['NAXIS1  = 2'.padEnd(80)]))).rejects.toThrow('Malformed')
    const wrongScale = fixture(16, [0, 1, 2, 3])
    wrongScale.write('2', 8 * 80 + 10)
    await expect(readRetainedFits(wrongScale)).rejects.toThrow('Unsupported')
    await expect(readRetainedFits(signed.subarray(0, 5759))).rejects.toThrow('payload length')
    const padding = Buffer.from(signed)
    padding[5759] = 1
    await expect(readRetainedFits(padding)).rejects.toThrow('padding')
    await expect(readRetainedFits(Buffer.concat([signed, Buffer.alloc(2880)]))).rejects.toThrow('payload length')
    const huge = Buffer.from(signed)
    huge.write('30000001', 3 * 80 + 10)
    await expect(readRetainedFits(huge)).rejects.toThrow('dimensions')
  })
})
