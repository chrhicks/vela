import {
  ImageBytesError,
  imageBytesMetadata as decodeMetadata,
  imageBytesPixels as decodePixels,
} from '@vela/equipment/image-bytes'
import { AlpacaProviderError } from '../error.js'

export function imageBytesMetadata(bytes: ArrayBuffer): DataView {
  try {
    return decodeMetadata(bytes)
  } catch (error) {
    if (error instanceof ImageBytesError) throw providerError(error)
    throw error
  }
}

export function imageBytesPixels(bytes: ArrayBuffer, width: number, height: number): Float64Array {
  try {
    return decodePixels(bytes, width, height)
  } catch (error) {
    if (error instanceof ImageBytesError) throw providerError(error)
    throw error
  }
}

function providerError(error: ImageBytesError): AlpacaProviderError {
  if (error.errorNumber !== undefined) {
    return new AlpacaProviderError(error.deviceMessage || `Alpaca image error ${error.errorNumber}`, {
      reason: error.reason,
      endpoint: 'imagearray',
      errorNumber: error.errorNumber,
    })
  }

  return new AlpacaProviderError(error.message, { reason: error.reason, endpoint: 'imagearray' })
}
