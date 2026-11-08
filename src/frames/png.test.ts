import { crc32 } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { decodePng } from '../testing/png.ts'
import { encodePng } from './png.ts'

describe('encodePng', () => {
  it('writes the signature and chunks with correct checksums', () => {
    const png = encodePng(2, 1, Uint8Array.from([1, 2, 3, 4, 5, 6]))

    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

    let offset = 8
    const types: string[] = []

    while (offset < png.length) {
      const length = png.readUInt32BE(offset)
      const body = png.subarray(offset + 4, offset + 8 + length)

      types.push(body.toString('latin1', 0, 4))
      expect(png.readUInt32BE(offset + 8 + length)).toBe(crc32(body))
      offset += 12 + length
    }

    expect(types).toEqual(['IHDR', 'IDAT', 'IEND'])
  })

  it('round-trips the pixels through a plain decoder', () => {
    const rgb = Uint8Array.from({ length: 3 * 4 * 3 }, (_, index) => (index * 7) % 256)

    expect(decodePng(encodePng(4, 3, rgb))).toEqual({ width: 4, height: 3, rgb })
  })
})
