const blockBytes = 2880
const cardBytes = 80

export type HeaderValue = string | number | boolean

export interface Fits {
  readonly header: ReadonlyMap<string, HeaderValue>
  readonly width: number
  readonly height: number
  readonly pixels: Uint16Array
}

function parseValue(text: string): HeaderValue {
  const trimmed = text.trim()

  if (trimmed.startsWith("'")) {
    let value = ''
    let index = 1

    while (index < trimmed.length) {
      if (trimmed[index] === "'") {
        if (trimmed[index + 1] !== "'") break
        index += 1
      }
      value += trimmed[index]
      index += 1
    }

    return value.trimEnd()
  }

  const bare = (trimmed.split('/')[0] ?? '').trim()

  if (bare === 'T') return true
  if (bare === 'F') return false

  const number = Number(bare)

  return bare !== '' && Number.isFinite(number) ? number : bare
}

function readHeader(bytes: Buffer) {
  const header = new Map<string, HeaderValue>()

  for (let offset = 0; offset + cardBytes <= bytes.length; offset += cardBytes) {
    const card = bytes.toString('latin1', offset, offset + cardBytes)
    const keyword = card.slice(0, 8).trim()

    if (keyword === 'END') return { header, dataStart: Math.ceil((offset + cardBytes) / blockBytes) * blockBytes }
    if (card.slice(8, 10) === '= ') header.set(keyword, parseValue(card.slice(10)))
  }

  throw new Error('FITS header has no END card')
}

function integerKey(header: ReadonlyMap<string, HeaderValue>, key: string) {
  const value = header.get(key)

  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`FITS header ${key} is not an integer`)

  return value
}

function numberKey(header: ReadonlyMap<string, HeaderValue>, key: string, fallback: number) {
  const value = header.get(key)

  return typeof value === 'number' ? value : fallback
}

export function readFits(bytes: Buffer): Fits {
  const { header, dataStart } = readHeader(bytes)

  if (header.get('SIMPLE') !== true) throw new Error('not a FITS file')
  if (integerKey(header, 'BITPIX') !== 16) throw new Error('only 16-bit FITS images are read')
  if (integerKey(header, 'NAXIS') !== 2) throw new Error('only two-dimensional FITS images are read')

  const width = integerKey(header, 'NAXIS1')
  const height = integerKey(header, 'NAXIS2')
  const count = width * height

  if (bytes.length < dataStart + count * 2) throw new Error('FITS file ends before its pixels do')

  const scale = numberKey(header, 'BSCALE', 1)
  const zero = numberKey(header, 'BZERO', 0)
  const pixels = new Uint16Array(count)

  for (let index = 0; index < count; index += 1) {
    const value = Math.round(bytes.readInt16BE(dataStart + index * 2) * scale + zero)

    pixels[index] = value < 0 ? 0 : value > 65535 ? 65535 : value
  }

  return { header, width, height, pixels }
}
