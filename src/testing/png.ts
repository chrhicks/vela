import { inflateSync } from 'node:zlib'

export function decodePng(png: Buffer) {
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  const idatLength = png.readUInt32BE(33)
  const rows = inflateSync(png.subarray(41, 41 + idatLength))
  const rowBytes = width * 3
  const rgb = new Uint8Array(rowBytes * height)

  for (let row = 0; row < height; row += 1) {
    if (rows[row * (rowBytes + 1)] !== 0) throw new Error('only filter 0 rows are decoded')
    rgb.set(rows.subarray(row * (rowBytes + 1) + 1, (row + 1) * (rowBytes + 1)), row * rowBytes)
  }

  return { width, height, rgb }
}
