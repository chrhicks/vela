import { Match } from 'effect'
import { describe, expect, it } from 'vitest'
import { imageBytesPixels } from './image-bytes.js'

function imageBytes(type = 8, samples = [1, 256, 65535, 2, 40000, 3], dataStart = 44) {
  const size = Match.value(type).pipe(
    Match.when(6, () => 1),
    Match.when(2, () => 4),
    Match.orElse(() => 2),
  )

  const bytes = new ArrayBuffer(dataStart + samples.length * size)
  const view = new DataView(bytes)
  const header = [1, 0, 0, 0, dataStart, 2, type, 2, 2, 3, 0]
  header.forEach((value, index) => view.setInt32(index * 4, value, true))
  samples.forEach((value, index) => {
    const offset = dataStart + index * size

    if (type === 6) view.setUint8(offset, value)
    else if (type === 2) view.setInt32(offset, value, true)
    else if (type === 1) view.setInt16(offset, value, true)
    else view.setUint16(offset, value, true)
  })

  return bytes
}

describe('ImageBytes rank-2 Int32 source images', () => {
  it.each([
    { type: 1, samples: [-32768, -1, 0, 32767, 256, -256] },
    { type: 2, samples: [-2147483648, 2135263542, 0, 2147483647, 256, -256] },
    { type: 6, samples: [0, 255, 1, 200, 100, 2] },
    { type: 8, samples: [0, 65535, 1, 40000, 256, 2] },
  ])('decodes little-endian type $type into unchanged row-major samples', ({ type, samples }) => {
    const pixels = imageBytesPixels(imageBytes(type, samples), 2, 3)
    expect(Array.from(pixels)).toEqual([samples[0], samples[3], samples[1], samples[4], samples[2], samples[5]])
  })

  it('honors DataStart, including an unaligned offset after extended metadata', () => {
    expect(Array.from(imageBytesPixels(imageBytes(8, undefined, 49), 2, 3))).toEqual([1, 2, 256, 40000, 65535, 3])
  })

  it.each([
    { field: 0, value: 2 }, { field: 0, value: 0x01000000 },
    { field: 4, value: -1 },
    { field: 16, value: 43 }, { field: 16, value: 1000 },
    { field: 20, value: 3 }, { field: 24, value: 9 }, { field: 24, value: 0 },
    { field: 28, value: 3 }, { field: 32, value: 3 },
    { field: 36, value: -1 }, { field: 40, value: 1 },
  ])('rejects incompatible or malformed metadata: %j', ({ field, value }) => {
    const bytes = imageBytes()
    new DataView(bytes).setInt32(field, value, true)
    expect(() => imageBytesPixels(bytes, 2, 3)).toThrow()
  })

  it('rejects truncated metadata, truncated pixels, and unexpected trailing pixels', () => {
    const bytes = imageBytes()

    for (const malformed of [bytes.slice(0, 43), bytes.slice(0, -1), imageBytes(8, [1, 2, 3, 4, 5, 6, 7])]) {
      expect(() => imageBytesPixels(malformed, 2, 3)).toThrow()
    }
  })

  it('reports a UTF-8 device error before interpreting zeroed image dimensions and types', () => {
    const message = new TextEncoder().encode('Caméra indisponible')
    const bytes = new ArrayBuffer(44 + message.length)
    const view = new DataView(bytes)
    view.setInt32(0, 1, true)
    view.setInt32(4, 1025, true)
    view.setInt32(16, 44, true)
    new Uint8Array(bytes, 44).set(message)
    expect(() => imageBytesPixels(bytes, 2, 3)).toThrow('Caméra indisponible')

    try {
      imageBytesPixels(bytes, 2, 3)
    } catch (error) {
      expect(error).toMatchObject({ reason: 'protocol-error', errorNumber: 1025 })
    }

    new Uint8Array(bytes)[44] = 0xff
    expect(() => imageBytesPixels(bytes, 2, 3)).toThrow('UTF-8')
  })
})
