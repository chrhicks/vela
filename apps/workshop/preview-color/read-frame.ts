import type { PreviewFrame } from './treatment.js'

/** Intentionally bounded to this workshop's Vela-produced, single-HDU signed32 corpus. */
export function readFrame(bytes: Buffer): PreviewFrame {
  if (bytes.length < 2880) throw new Error('Truncated FITS header')
  const cards = new Map<string, string>()
  let ended = false

  for (let offset = 0; offset < 2880; offset += 80) {
    const card = bytes.toString('ascii', offset, offset + 80)
    const key = card.slice(0, 8).trim()

    if (key === 'END') {
      ended = true
      break
    }

    if (card.slice(8, 10) !== '= ') continue

    if (cards.has(key)) throw new Error(`Duplicate FITS card: ${key}`)
    cards.set(
      key,
      card
        .slice(10)
        .trim()
        .replace(/^'(.*)'$/, '$1'),
    )
  }

  if (
    !ended ||
    cards.get('SIMPLE') !== 'T' ||
    cards.get('BITPIX') !== '32' ||
    cards.get('NAXIS') !== '2' ||
    cards.has('BZERO') ||
    cards.has('BSCALE') ||
    cards.get('ROWORDER') !== 'TOP-DOWN'
  ) {
    throw new Error('Workshop requires Vela signed32, TOP-DOWN, unscaled 2D FITS')
  }

  const width = Number(cards.get('NAXIS1')),
    height = Number(cards.get('NAXIS2'))

  const count = width * height

  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    count > 30_000_000 ||
    bytes.length !== 2880 + Math.ceil((count * 4) / 2880) * 2880
  ) {
    throw new Error('Invalid FITS dimensions or payload length')
  }

  const pattern = cards.get('BAYERPAT')?.toLowerCase()

  if (
    pattern !== undefined &&
    pattern !== 'rggb' &&
    pattern !== 'grbg' &&
    pattern !== 'gbrg' &&
    pattern !== 'bggr'
  )
    throw new Error('Unsupported Bayer pattern')
  const pixels = new Int32Array(count)

  for (let i = 0; i < count; i++) pixels[i] = bytes.readInt32BE(2880 + i * 4)

  return {
    width,
    height,
    pixels,
    color: pattern ? { kind: 'bayer', pattern } : { kind: 'mono' },
  }
}
