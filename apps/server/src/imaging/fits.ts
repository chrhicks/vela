import { setImmediate } from 'node:timers/promises'
import type { CaptureImage } from '@vela/model/web'
import type { ImageColor } from './preview.js'

/** Export acquisition samples without stretching, calibration, or row reversal. */
export async function encodeCaptureFits(
  frame: { width: number, height: number, pixels: ArrayLike<number>, capturedAt: string, capturedAtSource?: CaptureImage['capturedAtSource'], color?: ImageColor },
  metadata: { exposureSeconds: number, cameraName: string },
): Promise<Buffer> {
  const { width, height, pixels } = frame

  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1 || pixels.length !== width * height) {
    throw new Error('Cannot export FITS: image dimensions do not match its samples')
  }

  const start = new Date(frame.capturedAt)

  if (!Number.isFinite(start.getTime()) || !Number.isFinite(metadata.exposureSeconds) || metadata.exposureSeconds < 0) {
    throw new Error('Cannot export FITS: invalid exposure metadata')
  }

  let unsigned16 = true

  for (let begin = 0; begin < pixels.length; begin += 65_536) {
    const end = Math.min(begin + 65_536, pixels.length)

    for (let i = begin; i < end; i++) {
      const value = pixels[i]!

      if (!Number.isInteger(value) || value < -2_147_483_648 || value > 2_147_483_647) {
        throw new Error('Cannot export FITS: samples must be signed 32-bit integers')
      }

      if (value < 0 || value > 65_535) unsigned16 = false
    }

    await setImmediate()
  }

  const bytesPerSample = unsigned16 ? 2 : 4

  const cards = [
    card('SIMPLE', 'T'.padStart(20)), numberCard('BITPIX', bytesPerSample * 8), numberCard('NAXIS', 2),
    numberCard('NAXIS1', width), numberCard('NAXIS2', height),
    textCard('DATE-OBS', start.toISOString()), numberCard('EXPTIME', metadata.exposureSeconds),
    textCard('INSTRUME', metadata.cameraName), textCard('ROWORDER', 'TOP-DOWN'),
  ]

  if (unsigned16) cards.push(numberCard('BZERO', 32_768), numberCard('BSCALE', 1))

  if (frame.capturedAtSource === 'server-estimate') {
    cards.push(textCard('TIMESRC', 'SERVER-ESTIMATE'))
    cards.push('COMMENT DATE-OBS estimated from server UTC before StartExposure.'.padEnd(80))
  }

  // The acquisition adapter already shifts this pattern to the image origin.
  if (frame.color?.kind === 'bayer') cards.push(textCard('BAYERPAT', frame.color.pattern.toUpperCase()))
  cards.push('END'.padEnd(80))
  const header = Buffer.from(cards.join('').padEnd(Math.ceil(cards.length * 80 / 2880) * 2880), 'ascii')
  const result = Buffer.alloc(header.length + Math.ceil(pixels.length * bytesPerSample / 2880) * 2880)
  header.copy(result)

  for (let begin = 0; begin < pixels.length; begin += 65_536) {
    const end = Math.min(begin + 65_536, pixels.length)

    for (let i = begin; i < end; i++) {
      const value = pixels[i]!

      if (unsigned16) result.writeInt16BE(value - 32_768, header.length + i * 2)
      else result.writeInt32BE(value, header.length + i * 4)
    }

    await setImmediate()
  }

  return result
}

function textCard(key: string, value: string) {
  // FITS headers are ASCII. Escape apostrophes before fitting the value to one card.
  let text = ''

  for (const character of value.replace(/[^\x20-\x7e]/g, '?')) {
    const next = character === "'" ? "''" : character

    if (text.length + next.length > 68) break
    text += next
  }

  return card(key, `'${text}'`)
}

function numberCard(key: string, value: number) {
  return card(key, String(value).toUpperCase().padStart(20))
}

function card(key: string, encoded: string) {
  return `${key.padEnd(8)}= ${encoded}`.padEnd(80)
}
