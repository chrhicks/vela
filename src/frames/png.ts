import { crc32, deflateSync } from 'node:zlib'

const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const rgbColourType = 2
const bitDepth = 8

function chunk(type: string, data: Buffer) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const length = Buffer.alloc(4)
  const checksum = Buffer.alloc(4)

  length.writeUInt32BE(data.length)
  checksum.writeUInt32BE(crc32(body))

  return Buffer.concat([length, body, checksum])
}

export function encodePng(width: number, height: number, rgb: Uint8Array) {
  const header = Buffer.alloc(13)

  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = bitDepth
  header[9] = rgbColourType

  const rowBytes = width * 3
  const rows = Buffer.alloc((rowBytes + 1) * height)

  for (let row = 0; row < height; row += 1) rows.set(rgb.subarray(row * rowBytes, (row + 1) * rowBytes), row * (rowBytes + 1) + 1)

  return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}
