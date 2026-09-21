import { deflate } from 'node:zlib'
import { promisify } from 'node:util'
import { setImmediate } from 'node:timers/promises'

const compress = promisify(deflate)

// PNG's reflected CRC-32 polynomial. Precompute the eight bit steps for each byte.
const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  let crc = byte

  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)

  return crc >>> 0
})

export async function encodePng(width: number, height: number, channels: number, data: Buffer) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = channels === 3 ? 2 : 0
  const compressed = await compress(data)

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    await chunk('IHDR', header),
    await chunk('IDAT', compressed),
    await chunk('IEND', Buffer.alloc(0)),
  ])
}

async function chunk(type: string, data: Buffer): Promise<Buffer> {
  const name = Buffer.from(type)
  let crc = 0xffffffff

  for (const bytes of [name, data]) {
    for (let index = 0; index < bytes.length; index++) {
      if (index % 262_144 === 0) await setImmediate()
      crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[index]!) & 0xff]!
    }
  }

  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)

  return Buffer.concat([length, name, data, checksum])
}
