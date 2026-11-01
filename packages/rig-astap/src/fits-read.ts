import type { FrameColor, MonoFrame } from './frame.ts'

const block = 2880

const card = 80

export type FitsRead =
  | { readonly ok: true; readonly frame: MonoFrame }
  | { readonly ok: false; readonly reason: string }

function cardValue(text: string): string {
  const quoted = /^'((?:[^']|'')*)'/.exec(text.trim())

  if (quoted) return (quoted[1] ?? '').replace(/''/g, "'").trim()

  return (text.split('/')[0] ?? '').trim()
}

function readHeader(bytes: Uint8Array): { readonly cards: Map<string, string>; readonly dataStart: number } | undefined {
  const cards = new Map<string, string>()
  const text = new TextDecoder('ascii')

  for (let offset = 0; offset + card <= bytes.length; offset += card) {
    const line = text.decode(bytes.subarray(offset, offset + card))
    const key = line.slice(0, 8).trim()

    if (key === 'END') return { cards, dataStart: Math.ceil((offset + card) / block) * block }

    if (line.slice(8, 10) === '= ' && !cards.has(key)) cards.set(key, cardValue(line.slice(10)))
  }

  return undefined
}

function colorOf(pattern: string | undefined): FrameColor | undefined {
  if (pattern === undefined) return { kind: 'mono' }

  const lower = pattern.toLowerCase()

  return lower === 'rggb' || lower === 'grbg' || lower === 'gbrg' || lower === 'bggr' ? { kind: 'bayer', pattern: lower } : undefined
}

/**
 * Reads the FITS files Vela keeps as originals: two-dimensional, top-down rows, unsigned 16-bit (BZERO 32768)
 * or signed 32-bit samples. Anything else is refused with a reason rather than guessed at.
 */
export function readFits(bytes: Uint8Array): FitsRead {
  const header = readHeader(bytes)

  if (!header) return { ok: false, reason: 'no END card in the first headers' }

  const { cards, dataStart } = header
  const width = Number(cards.get('NAXIS1'))
  const height = Number(cards.get('NAXIS2'))
  const bitpix = cards.get('BITPIX')
  const exposureSeconds = Number(cards.get('EXPTIME') ?? 0)
  const capturedAt = cards.get('DATE-OBS')
  const color = colorOf(cards.get('BAYERPAT'))

  if (cards.get('SIMPLE') !== 'T' || cards.get('NAXIS') !== '2') return { ok: false, reason: 'not a two-dimensional FITS image' }

  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) return { ok: false, reason: 'bad image size' }

  if (cards.get('ROWORDER') !== 'TOP-DOWN') return { ok: false, reason: 'rows are not top-down' }

  if (capturedAt === undefined || !Number.isFinite(Date.parse(capturedAt))) return { ok: false, reason: 'no valid DATE-OBS' }

  if (color === undefined) return { ok: false, reason: 'unknown BAYERPAT' }

  if (!Number.isFinite(exposureSeconds) || exposureSeconds < 0) return { ok: false, reason: 'bad EXPTIME' }

  const unsigned16 = bitpix === '16' && cards.get('BZERO') === '32768' && cards.get('BSCALE') === '1'
  const signed32 = bitpix === '32' && !cards.has('BZERO') && !cards.has('BSCALE')

  if (!unsigned16 && !signed32) return { ok: false, reason: `unsupported sample format (BITPIX ${bitpix ?? 'missing'})` }

  const samples = width * height
  const bytesPerSample = unsigned16 ? 2 : 4

  if (bytes.length < dataStart + samples * bytesPerSample) return { ok: false, reason: 'the file ends before the last sample' }

  const view = new DataView(bytes.buffer, bytes.byteOffset + dataStart, samples * bytesPerSample)
  const pixels = unsigned16 ? new Uint16Array(samples) : new Int32Array(samples)

  if (pixels instanceof Uint16Array) for (let index = 0; index < samples; index++) pixels[index] = view.getInt16(index * 2) + 32768
  else for (let index = 0; index < samples; index++) pixels[index] = view.getInt32(index * 4)

  return {
    ok: true,
    frame: {
      width,
      height,
      pixels,
      capturedAt,
      capturedAtSource: cards.get('TIMESRC') === 'SERVER-ESTIMATE' ? 'server-estimate' : 'camera',
      exposureSeconds,
      color,
    },
  }
}
