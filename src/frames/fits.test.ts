import { describe, expect, it } from 'vitest'
import { syntheticFits } from '../testing/fits.ts'
import { readFits } from './fits.ts'

describe('readFits', () => {
  it('reads a camera frame that has EXTEND, COMMENT cards and BZERO 32768', () => {
    const fits = readFits(syntheticFits({ width: 4, height: 2, pixel: (x, y) => 1000 * y + x + 40000, pattern: 'RGGB', rowOrder: 'TOP-DOWN' }))

    expect(fits.width).toBe(4)
    expect(fits.height).toBe(2)
    expect([...fits.pixels]).toEqual([40000, 40001, 40002, 40003, 41000, 41001, 41002, 41003])
    expect(fits.header.get('BAYERPAT')).toBe('RGGB')
    expect(fits.header.get('ROWORDER')).toBe('TOP-DOWN')
    expect(fits.header.get('EXTEND')).toBe(true)
    expect(fits.header.get('EXPTIME')).toBe(1)
  })

  it('reads values of the whole 16-bit range through BZERO', () => {
    expect([...readFits(syntheticFits({ width: 3, height: 1, pixel: x => [0, 32768, 65535][x] ?? 0 })).pixels]).toEqual([0, 32768, 65535])
  })

  it('refuses a file that is not a 16-bit two-dimensional FITS image', () => {
    expect(() => readFits(Buffer.from('not a fits file'.padEnd(2880, ' ')))).toThrow()
    expect(() => readFits(syntheticFits({ width: 2, height: 2, pixel: () => 0, bitpix: 32 }))).toThrow('16-bit')
  })

  it('refuses a file that ends before its pixels do', () => {
    const whole = syntheticFits({ width: 2000, height: 2, pixel: () => 0 })

    expect(() => readFits(whole.subarray(0, 2880 + 100))).toThrow('ends before')
  })
})
