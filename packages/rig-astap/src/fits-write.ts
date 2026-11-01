import type { MonoFrame } from './frame.ts'

const block = 2880

function card(key: string, value: string): string {
  return `${key.padEnd(8)}= ${value}`.padEnd(80)
}

const text = (key: string, value: string) => card(key, `'${value.replace(/[^\x20-\x7e]/g, '?').replace(/'/g, "''").slice(0, 68)}'`)

const number = (key: string, value: number) => card(key, String(value).toUpperCase().padStart(20))

/** The FITS ASTAP reads: the frame's samples untouched, in the layout Vela's own solver feeds it. */
export function writeFits(frame: MonoFrame): Uint8Array {
  const { width, height, pixels } = frame

  if (pixels.length !== width * height) throw new Error('the frame size does not match its samples')

  let unsigned16 = true

  for (let index = 0; index < pixels.length; index++) {
    const value = pixels[index]!

    if (!Number.isInteger(value) || value < -2_147_483_648 || value > 2_147_483_647) throw new Error('samples must be signed 32-bit integers')

    if (value < 0 || value > 65_535) unsigned16 = false
  }

  const bytesPerSample = unsigned16 ? 2 : 4

  const cards = [
    card('SIMPLE', 'T'.padStart(20)),
    number('BITPIX', bytesPerSample * 8),
    number('NAXIS', 2),
    number('NAXIS1', width),
    number('NAXIS2', height),
    text('DATE-OBS', new Date(frame.capturedAt).toISOString()),
    number('EXPTIME', frame.exposureSeconds),
    text('IMAGETYP', 'LIGHT'),
    text('ROWORDER', 'TOP-DOWN'),
    ...(unsigned16 ? [number('BZERO', 32_768), number('BSCALE', 1)] : []),
    ...(frame.color.kind === 'bayer' ? [text('BAYERPAT', frame.color.pattern.toUpperCase())] : []),
    'END'.padEnd(80),
  ]

  const header = new TextEncoder().encode(cards.join('').padEnd(Math.ceil((cards.length * 80) / block) * block))
  const result = new Uint8Array(header.length + Math.ceil((pixels.length * bytesPerSample) / block) * block)
  const view = new DataView(result.buffer)

  result.set(header)

  for (let index = 0; index < pixels.length; index++) {
    const value = pixels[index]!

    if (unsigned16) view.setInt16(header.length + index * 2, value - 32_768)
    else view.setInt32(header.length + index * 4, value)
  }

  return result
}
