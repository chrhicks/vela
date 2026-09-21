import { setImmediate } from 'node:timers/promises'

interface Frame {
  pixels: Uint16Array
  width: number
  height: number
}

interface Envelope {
  ClientTransactionID: number
  ServerTransactionID: number
  ErrorNumber: number
  ErrorMessage: string
}

// ImageBytes requires explicit client opt-in; ordinary browser */* stays JSON.
export function acceptsImageBytes(accept: string | undefined) {
  return (
    accept?.split(',').some(item => {
      const [type, ...parameters] = item.trim().toLowerCase().split(';')

      const quality = parameters
        .find(value => value.trim().startsWith('q='))
        ?.trim()
        .slice(2)

      return (
        type?.trim() === 'application/imagebytes' && (quality === undefined || Number(quality) > 0)
      )
    }) ?? false
  )
}

/** ASCOM Alpaca API Reference §8: Int32 source, UInt16 wire, little endian, Y fastest. */
export async function encodeImageBytes(
  frame: Frame,
  envelope: Envelope,
  assertCurrent: () => void = () => {},
) {
  assertCurrent()
  const { width, height, pixels } = frame
  const bytes = Buffer.allocUnsafe(44 + width * height * 2)

  const metadata = [
    1,
    0,
    envelope.ClientTransactionID,
    envelope.ServerTransactionID,
    44,
    2,
    8,
    2,
    width,
    height,
    0,
  ]

  metadata.forEach((value, index) => bytes.writeUInt32LE(value, index * 4))
  let offset = 44

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      bytes.writeUInt16LE(pixels[y * width + x]!, offset)
      offset += 2
    }

    if (x % 32 === 31) {
      await setImmediate()
      assertCurrent()
    }
  }

  assertCurrent()

  return bytes
}

// Serialize one column at a time so the JSON fallback does not expand a full
// sensor into nested arrays. If invalidated mid-stream, truncate the response:
// the client must reject it, never receive a complete stale success envelope.
export async function* imageJsonChunks(
  frame: Frame,
  envelope: Envelope,
  assertCurrent: () => void = () => {},
) {
  assertCurrent()
  yield `${JSON.stringify({ ...envelope, Type: 2, Rank: 2 }).slice(0, -1)},"Value":[`
  const column = Array.from({ length: frame.height }, () => 0)

  for (let x = 0; x < frame.width; x++) {
    assertCurrent()

    for (let y = 0; y < frame.height; y++) column[y] = frame.pixels[y * frame.width + x]!
    yield `${x === 0 ? '' : ','}${JSON.stringify(column)}`

    if (x % 16 === 15) await setImmediate()
  }

  assertCurrent()
  yield ']}'
}

export function imageBytesError(envelope: Envelope) {
  const message = Buffer.from(envelope.ErrorMessage, 'utf8')
  const bytes = Buffer.alloc(44 + message.length)

  const metadata = [
    1,
    envelope.ErrorNumber,
    envelope.ClientTransactionID,
    envelope.ServerTransactionID,
    44,
    0,
    0,
    0,
    0,
    0,
    0,
  ]

  metadata.forEach((value, index) => bytes.writeUInt32LE(value, index * 4))
  message.copy(bytes, 44)

  return bytes
}
