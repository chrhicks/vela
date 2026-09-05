import { expect, it } from 'vitest'
import { inflateSync } from 'node:zlib'
import { encodePng } from './png.js'

// Independent bit-at-a-time reference protects the optimized byte lookup.
function referenceCrc(bytes: Buffer) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

it('encodes lossless pixels and valid PNG checksums across multiple processing batches', async () => {
  const width = 512, height = 512, stride = width * 3 + 1
  const data = Buffer.alloc(stride * height)
  let seed = 37
  for (let y = 0; y < height; y++) for (let x = 1; x < stride; x++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    data[y * stride + x] = seed >>> 24
  }
  const original = Buffer.from(data)
  const png = await encodePng(width, height, 3, data)
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const kinds: string[] = []
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset)
    const kind = png.toString('ascii', offset + 4, offset + 8)
    const payload = png.subarray(offset + 8, offset + 8 + length)
    const crc = png.readUInt32BE(offset + 8 + length)
    kinds.push(kind)
    expect(crc).toBe(referenceCrc(png.subarray(offset + 4, offset + 8 + length)))
    if (kind === 'IDAT') {
      expect(length).toBeGreaterThan(262_144)
      expect(inflateSync(payload)).toEqual(original)
    }
    if (kind === 'IEND') expect(crc).toBe(0xae426082)
    offset += length + 12
  }
  expect(kinds).toEqual(['IHDR', 'IDAT', 'IEND'])
  expect(data).toEqual(original)
})
