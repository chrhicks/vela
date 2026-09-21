// FITS primary image: signed 16-bit, big-endian pixels, 2880-byte blocks.
// There is deliberately no WCS or pointing hint: the solver must recover it.
export function writeFits(width: number, height: number, pixels: Uint16Array): Buffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height !== pixels.length) {
    throw new Error('FITS dimensions do not match the image')
  }

  if (pixels.some(value => value > 32767))
    throw new Error('FITS pixels must fit positive signed 16-bit values')
  const card = (keyword: string, value: string) => `${keyword.padEnd(8)}= ${value.padStart(20)}`.padEnd(80)

  const header = [
    card('SIMPLE', 'T'),
    card('BITPIX', '16'),
    card('NAXIS', '2'),
    card('NAXIS1', String(width)),
    card('NAXIS2', String(height)),
    'END'.padEnd(80),
  ].join('')

  const headerBytes = Math.ceil(header.length / 2880) * 2880
  const imageBytes = Math.ceil(pixels.length * 2 / 2880) * 2880
  const result = Buffer.alloc(headerBytes + imageBytes)
  result.fill(32, 0, headerBytes)
  result.write(header, 'ascii')

  for (let index = 0; index < pixels.length; index++)
    result.writeInt16BE(pixels[index]!, headerBytes + index * 2)

  return result
}
