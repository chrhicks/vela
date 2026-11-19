import { encodePng } from '../frames/png.ts'

export interface Rgb {
  readonly width: number
  readonly height: number
  readonly rgb: Uint8Array
}

const pngSignatureBytes = 8
const keptChunks: ReadonlySet<string> = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND'])
const shrinkFactor = 0.75

export function shrunk(picture: Rgb, longSide: number): Rgb {
  const { width, height, rgb } = picture
  const scale = Math.min(1, longSide / Math.max(width, height))

  if (scale === 1) return picture

  const outWidth = Math.max(1, Math.round(width * scale))
  const outHeight = Math.max(1, Math.round(height * scale))
  const out = new Uint8Array(outWidth * outHeight * 3)

  for (let oy = 0; oy < outHeight; oy += 1) {
    const top = Math.floor((oy * height) / outHeight)
    const bottom = Math.max(top + 1, Math.floor(((oy + 1) * height) / outHeight))

    for (let ox = 0; ox < outWidth; ox += 1) {
      const left = Math.floor((ox * width) / outWidth)
      const right = Math.max(left + 1, Math.floor(((ox + 1) * width) / outWidth))
      const sums = [0, 0, 0]

      for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) {
          for (let channel = 0; channel < 3; channel += 1) sums[channel] = (sums[channel] ?? 0) + (rgb[(y * width + x) * 3 + channel] ?? 0)
        }
      }

      const count = (bottom - top) * (right - left)

      for (let channel = 0; channel < 3; channel += 1) out[(oy * outWidth + ox) * 3 + channel] = Math.round((sums[channel] ?? 0) / count)
    }
  }

  return { width: outWidth, height: outHeight, rgb: out }
}

export function withoutMetadata(png: Uint8Array): Uint8Array {
  const bytes = Buffer.from(png)
  const kept: Buffer[] = [bytes.subarray(0, pngSignatureBytes)]
  let at = pngSignatureBytes

  while (at + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(at)
    const end = at + 12 + length

    if (keptChunks.has(bytes.toString('latin1', at + 4, at + 8))) kept.push(bytes.subarray(at, end))
    at = end
  }

  return Buffer.concat(kept)
}

export function pictureFor(picture: Rgb, longSide: number, maxBytes: number): Uint8Array {
  let side = longSide

  for (;;) {
    const fitted = shrunk(picture, side)
    const png = withoutMetadata(encodePng(fitted.width, fitted.height, fitted.rgb))

    if (png.length <= maxBytes || Math.max(fitted.width, fitted.height) <= 1) return png
    side = Math.floor(Math.max(fitted.width, fitted.height) * shrinkFactor)
  }
}
