import { AlpacaProviderError } from '../error.js'

/** Validate the envelope before treating an HTTP 200 image transfer as successful. */
export function imageBytesMetadata(bytes: ArrayBuffer): DataView {
  function invalid(message: string): never {
    throw new AlpacaProviderError(message, { reason: 'invalid-response', endpoint: 'imagearray' })
  }
  if (bytes.byteLength < 44) invalid('Truncated ImageBytes metadata')
  const view = new DataView(bytes)
  if (view.getInt32(0, true) !== 1) invalid('Unsupported ImageBytes metadata version')
  // Transaction identifiers are unsigned; all other metadata fields are nonnegative Int32.
  for (const offset of [4, 16, 20, 24, 28, 32, 36, 40]) {
    if (view.getInt32(offset, true) < 0) invalid('Negative ImageBytes metadata value')
  }
  const errorNumber = view.getInt32(4, true)
  const dataStart = view.getInt32(16, true)
  if (dataStart < 44 || dataStart > bytes.byteLength) invalid('Invalid ImageBytes data offset')
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
  if (view.getInt32(20, true) !== 2 || view.getInt32(28, true) !== 2 || view.getInt32(40, true) !== 0) {
    invalid('Only rank-2 Int32 ImageBytes images are supported')
  }
  if (view.getInt32(32, true) !== width || view.getInt32(36, true) !== height) invalid('ImageBytes dimensions differ from exposure dimensions')
  const transmissionType = view.getInt32(24, true)
  let size: number
  let read: (offset: number) => number
  switch (transmissionType) {
    case 1:
      size = 2
      read = offset => view.getInt16(offset, true)
      break
    case 2:
      size = 4
      read = offset => view.getInt32(offset, true)
      break
    case 6:
      size = 1
      read = offset => view.getUint8(offset)
      break
    case 8:
      size = 2
      read = offset => view.getUint16(offset, true)
      break
    default: invalid('Unsupported ImageBytes transmission element type')
  }
  if (bytes.byteLength - dataStart !== width * height * size) invalid('ImageBytes payload length differs from image dimensions')
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
