import { describe, expect, it } from 'vitest'
import { ImageBytesError, imageBytesMetadata, imageBytesPixels } from '../src/image-bytes.js'

describe('shared ASCOM ImageBytes boundary', () => {
  it('reports malformed data and encoded device failures without an adapter dependency', () => {
    expect(() => imageBytesMetadata(new ArrayBuffer(0))).toThrow(ImageBytesError)
    const bytes = new ArrayBuffer(44)
    const view = new DataView(bytes)
    view.setInt32(0, 1, true)
    view.setInt32(4, 1025, true)
    view.setInt32(16, 44, true)

    expect(() => imageBytesPixels(bytes, 2, 3)).toThrowError(
      expect.objectContaining({
        name: 'ImageBytesError',
        reason: 'protocol-error',
        errorNumber: 1025,
        message: 'ASCOM image error 1025',
      }),
    )
  })
})
