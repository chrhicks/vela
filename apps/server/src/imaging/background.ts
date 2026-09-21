import { bayerPixel } from './bayer.js'
import type { ImageColor } from './preview.js'

export type PreviewFrame = {
  width: number
  height: number
  pixels: ArrayLike<number>
  color: ImageColor
}

export const PREVIEW_VERSION = 'background-v1'

export function linkedRange(pixels: ArrayLike<number>) {
  const stride = Math.max(1, Math.floor(pixels.length / 200_000) | 1)

  const sample = Array.from(
    { length: Math.ceil(pixels.length / stride) },
    (_, i) => pixels[i * stride]!,
  ).sort((a, b) => a - b)

  const black = sample[Math.floor(sample.length * 0.01)] ?? 0
  const ceiling = Math.max(black + 100, sample[Math.floor(sample.length * 0.999)] ?? 1000)

  return { black, ceiling }
}

const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]!

/** Display-only additive correction. The same dim tiles supply all channels; no gray-world gains. */
export function backgroundOffsets(frame: PreviewFrame, range: ReturnType<typeof linkedRange>) {
  const { width, height, pixels, color } = frame

  if (color.kind === 'mono' || width < 32 || height < 32) {
    return {
      offsets: [0, 0, 0],
      status: 'Unchanged: mono or insufficient spatial samples',
      background: [0, 0, 0],
    }
  }

  const tiles: number[][] = []

  for (let ty = 0; ty < 8; ty++) {
    for (let tx = 0; tx < 8; tx++) {
      const channels: number[][] = [[], [], []]
      const stepX = Math.max(1, Math.floor(width / 8 / 16) | 1)
      const stepY = Math.max(1, Math.floor(height / 8 / 16) | 1)

      for (let y = Math.floor((ty * height) / 8); y < ((ty + 1) * height) / 8; y += stepY) {
        for (let x = Math.floor((tx * width) / 8); x < ((tx + 1) * width) / 8; x += stepX) {
          const rgb = bayerPixel(width, height, pixels, color.pattern, x, y)

          if (!rgb.every(Number.isFinite)) continue
          rgb.forEach((value, channel) => channels[channel]!.push(value))
        }
      }

      if (channels[0]!.length >= 16) tiles.push(channels.map(median))
    }
  }

  if (tiles.length < 32 || !Number.isFinite(range.ceiling - range.black)) {
    return {
      offsets: [0, 0, 0],
      status: 'Unchanged: invalid background estimate',
      background: [0, 0, 0],
    }
  }

  // Field-filling emission can bias even these tiles. Bound correction rather than force gray.
  tiles.sort((a, b) => a[0]! + a[1]! + a[2]! - b[0]! - b[1]! - b[2]!)
  const darkTiles = tiles.slice(0, 16)
  const background = [0, 1, 2].map(channel => median(darkTiles.map(tile => tile[channel]!)))
  const floor = Math.min(...background)
  const cap = (range.ceiling - range.black) * 0.1
  const requested = background.map(value => value - floor)
  const offsets = requested.map(value => Math.min(cap, value))
  const bounded = requested.some(value => value > cap)

  return {
    offsets,
    background,
    status: bounded
      ? 'Bound reached: residual tint intentionally retained'
      : 'Background offsets within bound',
  }
}
