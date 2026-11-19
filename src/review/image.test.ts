import { crc32 } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { encodePng } from '../frames/png.ts'
import { decodePng } from '../testing/png.ts'
import { pictureFor, shrunk, withoutMetadata } from './image.ts'

function textChunk(keyword: string, text: string) {
  const type = Buffer.from('tEXt', 'latin1')
  const data = Buffer.from(`${keyword}\0${text}`, 'latin1')
  const length = Buffer.alloc(4)
  const checksum = Buffer.alloc(4)

  length.writeUInt32BE(data.length)
  checksum.writeUInt32BE(crc32(Buffer.concat([type, data])))

  return Buffer.concat([length, type, data, checksum])
}

const chunkTypes = (png: Uint8Array) => {
  const bytes = Buffer.from(png)
  const types: string[] = []

  for (let at = 8; at + 12 <= bytes.length; at += 12 + bytes.readUInt32BE(at)) types.push(bytes.toString('latin1', at + 4, at + 8))

  return types
}

const gradient = (width: number, height: number) => {
  const rgb = new Uint8Array(width * height * 3)

  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) rgb.set([x % 256, y % 256, (x + y) % 256], (y * width + x) * 3)

  return { width, height, rgb }
}

const noisy = (width: number, height: number) => {
  const rgb = new Uint8Array(width * height * 3)
  let seed = 12345

  for (let i = 0; i < rgb.length; i += 1) {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff
    rgb[i] = seed >> 16
  }

  return { width, height, rgb }
}

describe('the pictures sent with an ask', () => {
  it('leaves a picture alone when its long side fits', () => {
    const picture = gradient(40, 30)

    expect(shrunk(picture, 40)).toBe(picture)
    expect(shrunk(picture, 100)).toBe(picture)
  })

  it('shrinks a picture so its long side is the limit, keeping the shape', () => {
    const small = shrunk(gradient(400, 300), 100)

    expect([small.width, small.height]).toEqual([100, 75])
    expect(small.rgb).toHaveLength(100 * 75 * 3)
  })

  it('averages the pixels each new pixel covers', () => {
    const rgb = new Uint8Array([0, 0, 0, 100, 100, 100, 200, 200, 200, 100, 100, 100])
    const small = shrunk({ width: 2, height: 2, rgb }, 1)

    expect([small.width, small.height]).toEqual([1, 1])
    expect([...small.rgb]).toEqual([100, 100, 100])
  })

  it('takes out every chunk but the ones that draw the picture', () => {
    const plain = encodePng(4, 4, new Uint8Array(48))
    const header = plain.subarray(8, 8 + 25)
    const rest = plain.subarray(8 + 25)
    const marked = Buffer.concat([plain.subarray(0, 8), header, textChunk('Comment', 'DATE-OBS= 2026-11-18T03:00:00'), rest])

    expect(chunkTypes(marked)).toContain('tEXt')
    expect(marked.includes('DATE-OBS')).toBe(true)

    const clean = withoutMetadata(marked)

    expect(chunkTypes(clean)).toEqual(['IHDR', 'IDAT', 'IEND'])
    expect(Buffer.from(clean).includes('DATE-OBS')).toBe(false)
    expect(Buffer.from(clean).equals(plain)).toBe(true)
  })

  it('encodes a picture that decodes to the same pixels and carries no metadata chunk', () => {
    const picture = gradient(32, 24)
    const png = pictureFor(picture, 100, 1_000_000)

    expect(chunkTypes(png)).toEqual(['IHDR', 'IDAT', 'IEND'])
    expect(decodePng(Buffer.from(png)).rgb).toEqual(picture.rgb)
  })

  it('makes a picture smaller until it fits the byte limit', () => {
    const picture = noisy(200, 200)
    const whole = pictureFor(picture, 200, 10_000_000)
    const fitted = pictureFor(picture, 200, 60_000)

    expect(whole.length).toBeGreaterThan(60_000)
    expect(fitted.length).toBeLessThanOrEqual(60_000)
    expect(decodePng(Buffer.from(fitted)).width).toBeLessThan(200)
  })
})
