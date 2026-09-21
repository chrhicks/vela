import { setImmediate } from 'node:timers/promises'
import type { PreviewFrame } from './background.js'

export const MAX_RETAINED_FITS_BYTES = 2880 + Math.ceil(30_000_000 * 4 / 2880) * 2880

/** Only Vela's signed32 and offset unsigned16 originals, not arbitrary FITS imports. */
export async function readRetainedFits(bytes: Buffer): Promise<PreviewFrame> {
  if (bytes.length < 2880 || bytes.length > MAX_RETAINED_FITS_BYTES)
    throw new Error('Invalid retained FITS size')

  if (!bytes.subarray(0, 2880).every(value => value >= 32 && value <= 126))
    throw new Error('Invalid retained FITS header characters')
  const cards = new Map<string, string>()

  const supported = new Set([
    'SIMPLE',
    'BITPIX',
    'NAXIS',
    'NAXIS1',
    'NAXIS2',
    'DATE-OBS',
    'EXPTIME',
    'INSTRUME',
    'ROWORDER',
    'TIMESRC',
    'BAYERPAT',
    'BZERO',
    'BSCALE',
  ])

  let headerEnd = 0

  for (let offset = 0; offset < 2880; offset += 80) {
    const card = bytes.toString('ascii', offset, offset + 80)
    const key = card.slice(0, 8).trim()

    if (key === 'END') {
      if (card.trim() !== 'END') throw new Error('Malformed retained FITS END card')
      headerEnd = offset + 80
      break
    }

    if (key === 'COMMENT') continue

    if (!supported.has(key) || card.slice(8, 10) !== '= ' || cards.has(key))
      throw new Error('Malformed or unsupported retained FITS header')
    cards.set(key, card.slice(10).trim().replace(/^'(.*)'$/, '$1'))
  }

  if (!headerEnd || !bytes.subarray(headerEnd, 2880).every(value => value === 32))
    throw new Error('Invalid retained FITS header padding')
  const unsigned = cards.get('BITPIX') === '16' && cards.get('BZERO') === '32768' && cards.get('BSCALE') === '1'
  const signed = cards.get('BITPIX') === '32' && !cards.has('BZERO') && !cards.has('BSCALE')

  if (
    cards.get('SIMPLE') !== 'T'
    || cards.get('NAXIS') !== '2'
    || cards.get('ROWORDER') !== 'TOP-DOWN'
    || (!unsigned && !signed)
  ) {
    throw new Error('Unsupported retained FITS encoding')
  }

  const width = Number(cards.get('NAXIS1'))
  const height = Number(cards.get('NAXIS2'))
  const count = width * height
  const sampleBytes = unsigned ? 2 : 4
  const dataEnd = 2880 + count * sampleBytes

  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width < 1
    || height < 1
    || count > 30_000_000
    || bytes.length !== 2880 + Math.ceil(count * sampleBytes / 2880) * 2880
  ) {
    throw new Error('Invalid retained FITS dimensions or payload length')
  }

  if (!bytes.subarray(dataEnd).every(value => value === 0))
    throw new Error('Invalid retained FITS data padding')
  const pattern = cards.get('BAYERPAT')?.toLowerCase()

  if (
    pattern !== undefined
    && pattern !== 'rggb'
    && pattern !== 'grbg'
    && pattern !== 'gbrg'
    && pattern !== 'bggr'
  ) throw new Error('Unsupported retained Bayer pattern')
  const pixels = new Int32Array(count)

  for (let begin = 0; begin < count; begin += 65_536) {
    const end = Math.min(count, begin + 65_536)

    for (let i = begin; i < end; i++) {
      pixels[i] = unsigned
        ? bytes.readInt16BE(2880 + i * 2) + 32768
        : bytes.readInt32BE(2880 + i * 4)
    }

    await setImmediate()
  }

  return {
    width,
    height,
    pixels,
    color: pattern ? { kind: 'bayer', pattern } : { kind: 'mono' },
  }
}
