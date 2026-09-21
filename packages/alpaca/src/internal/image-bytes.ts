import { AlpacaProviderError } from '../error.js'

const metadataByteLength = 44

const elementType = { int16: 1, int32: 2, byte: 6, uint16: 8 } as const

const imageRank = 2

/** Validate the envelope before treating an HTTP 200 image transfer as successful. */
export function imageBytesMetadata(bytes: ArrayBuffer): DataView {
  function invalid(message: string): never {
    throw new AlpacaProviderError(message, { reason: 'invalid-response', endpoint: 'imagearray' })
  }

  if (bytes.byteLength < metadataByteLength) invalid('Truncated ImageBytes metadata')
  const view = new DataView(bytes)
  const metadataVersion = view.getInt32(0, true)
  const errorNumber = view.getInt32(4, true)
  const dataStart = view.getInt32(16, true)
  const imageElementType = view.getInt32(20, true)
  const transmissionElementType = view.getInt32(24, true)
  const rank = view.getInt32(28, true)
  const dimension1 = view.getInt32(32, true)
  const dimension2 = view.getInt32(36, true)
  const dimension3 = view.getInt32(40, true)

  if (metadataVersion !== 1) invalid('Unsupported ImageBytes metadata version')

  // Transaction identifiers are unsigned; all other metadata fields are nonnegative Int32.
  const nonnegativeFields = [
    errorNumber,
    dataStart,
    imageElementType,
    transmissionElementType,
    rank,
    dimension1,
    dimension2,
    dimension3,
  ]

  if (nonnegativeFields.some(value => value < 0)) invalid('Negative ImageBytes metadata value')

  if (dataStart < metadataByteLength || dataStart > bytes.byteLength)
    invalid('Invalid ImageBytes data offset')

  if (errorNumber !== 0) {
    let message: string

    try {
      message = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes, dataStart))
    } catch {
      invalid('Invalid ImageBytes UTF-8 error message')
    }

    throw new AlpacaProviderError(message || `Alpaca image error ${errorNumber}`, {
      reason: 'protocol-error',
      endpoint: 'imagearray',
      errorNumber,
    })
  }

  return view
}

/** Decode ImageBytes v1 without expanding the binary payload into nested JS arrays. */
export function imageBytesPixels(bytes: ArrayBuffer, width: number, height: number): Float64Array {
  function invalid(message: string): never {
    throw new AlpacaProviderError(message, { reason: 'invalid-response', endpoint: 'imagearray' })
  }

  const view = imageBytesMetadata(bytes)
  const dataStart = view.getInt32(16, true)
  const imageElementType = view.getInt32(20, true)
  const transmissionElementType = view.getInt32(24, true)
  const rank = view.getInt32(28, true)
  const dimension1 = view.getInt32(32, true)
  const dimension2 = view.getInt32(36, true)
  const dimension3 = view.getInt32(40, true)

  if (imageElementType !== elementType.int32 || rank !== imageRank || dimension3 !== 0) {
    invalid('Only rank-2 Int32 ImageBytes images are supported')
  }

  if (dimension1 !== width || dimension2 !== height) {
    invalid('ImageBytes dimensions differ from exposure dimensions')
  }

  let size: number
  let read: (offset: number) => number

  switch (transmissionElementType) {
    case elementType.int16:
      size = 2
      read = offset => view.getInt16(offset, true)
      break
    case elementType.int32:
      size = 4
      read = offset => view.getInt32(offset, true)
      break
    case elementType.byte:
      size = 1
      read = offset => view.getUint8(offset)
      break
    case elementType.uint16:
      size = 2
      read = offset => view.getUint16(offset, true)
      break
    default:
      invalid('Unsupported ImageBytes transmission element type')
  }

  if (bytes.byteLength - dataStart !== width * height * size)
    invalid('ImageBytes payload length differs from image dimensions')
  const pixels = new Float64Array(width * height)
  let offset = dataStart

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      pixels[y * width + x] = read(offset)
      offset += size
    }
  }

  return pixels
}
