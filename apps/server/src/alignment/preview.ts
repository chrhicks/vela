import { deflateSync } from 'node:zlib'

/** A display stretch only; the solver always receives the original pixels. */
export function previewPng(width: number, height: number, pixels: ArrayLike<number>): Buffer {
  const sample = Array.from({ length: Math.ceil(pixels.length / 32) }, (_, i) => pixels[i * 32]!).sort((a, b) => a - b)
  const background = sample[Math.floor(sample.length * 0.5)] ?? 0
  const ceiling = Math.max(background + 100, sample[Math.floor(sample.length * 0.999)] ?? 1000)
  const data = Buffer.alloc((width + 1) * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = Math.max(0, (pixels[y * width + x]! - background) / (ceiling - background))
      data[y * (width + 1) + x + 1] = Math.min(255, Math.round(255 * Math.asinh(value * 10) / Math.asinh(10)))
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(data)), chunk('IEND', Buffer.alloc(0))])
}

function chunk(type: string, data: Buffer): Buffer {
  const payload = Buffer.concat([Buffer.from(type), data])
  let crc = 0xffffffff
  for (const byte of payload) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
  return Buffer.concat([length, payload, checksum])
}
