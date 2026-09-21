import { setImmediate } from 'node:timers/promises'
import { bayerPixel } from '../../server/src/imaging/bayer.js'
import { createDisplayStretch } from '../../server/src/imaging/display-stretch.js'
import { encodePng } from '../../server/src/imaging/png.js'
import type { ImageColor } from '../../server/src/imaging/preview.js'

export type PreviewFrame = { width: number, height: number, pixels: ArrayLike<number>, color: ImageColor }

export function linkedRange(pixels: ArrayLike<number>) {
  const stride = Math.max(1, Math.floor(pixels.length / 200_000) | 1)
  const sample = Array.from({ length: Math.ceil(pixels.length / stride) }, (_, i) => pixels[i * stride]!).sort((a, b) => a - b)
  const black = sample[Math.floor(sample.length * 0.01)] ?? 0
  const ceiling = Math.max(black + 100, sample[Math.floor(sample.length * 0.999)] ?? 1000)

  return { black, ceiling }
}

const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]!

/** Workshop hypothesis: equalize only the dimmest spatial backgrounds, never channel gains. */
export function backgroundOffsets(frame: PreviewFrame, range: ReturnType<typeof linkedRange>) {
  const { width, height, pixels, color } = frame

  if (color.kind === 'mono' || width < 32 || height < 32) {
    return { offsets: [0, 0, 0], status: 'Unchanged: mono or insufficient spatial samples', background: [0, 0, 0] }
  }

  const tiles: number[][] = []

  for (let ty = 0; ty < 8; ty++) for (let tx = 0; tx < 8; tx++) {
    const channels: number[][] = [[], [], []]
    const stepX = Math.max(1, Math.floor(width / 8 / 16) | 1)
    const stepY = Math.max(1, Math.floor(height / 8 / 16) | 1)

    for (let y = Math.floor(ty * height / 8); y < (ty + 1) * height / 8; y += stepY) {
      for (let x = Math.floor(tx * width / 8); x < (tx + 1) * width / 8; x += stepX) {
        const rgb = bayerPixel(width, height, pixels, color.pattern, x, y)

        if (!rgb.every(Number.isFinite)) continue
        rgb.forEach((value, channel) => channels[channel]!.push(value))
      }
    }

    if (channels[0]!.length >= 16) tiles.push(channels.map(median))
  }

  if (tiles.length < 32 || !Number.isFinite(range.ceiling - range.black)) {
    return { offsets: [0, 0, 0], status: 'Unchanged: invalid background estimate', background: [0, 0, 0] }
  }

  // The same low-brightness tiles supply all channels. A nebula's mean is not a white reference.
  tiles.sort((a, b) => a[0]! + a[1]! + a[2]! - b[0]! - b[1]! - b[2]!)
  const darkTiles = tiles.slice(0, 16)
  const background = [0, 1, 2].map(channel => median(darkTiles.map(tile => tile[channel]!)))
  const floor = Math.min(...background)
  const cap = (range.ceiling - range.black) * 0.1
  const requested = background.map(value => value - floor)
  const offsets = requested.map(value => Math.min(cap, value))
  const bounded = requested.some(value => value > cap)

  return { offsets, background, status: bounded ? 'Bound reached: residual tint intentionally retained' : 'Background offsets within bound' }
}

export async function neutralPreviews(frame: PreviewFrame) {
  const { width, height, pixels, color } = frame
  const range = linkedRange(pixels)
  const estimate = backgroundOffsets(frame, range)
  const display = await createDisplayStretch(range.black, range.ceiling)
  const channels = color.kind === 'mono' ? 1 : 3
  const stride = width * channels + 1
  const data = Buffer.alloc(stride * height)

  for (let y = 0; y < height; y++) {
    if (y % 16 === 0) await setImmediate()

    for (let x = 0; x < width; x++) {
      const rgb = color.kind === 'bayer' ? bayerPixel(width, height, pixels, color.pattern, x, y) : [pixels[y * width + x]!]

      for (let channel = 0; channel < channels; channel++) {
        data[y * stride + x * channels + channel + 1] = display(rgb[channel]! - estimate.offsets[channel]!)
      }
    }
  }

  const native = await encodePng(width, height, channels, data)
  const factor = Math.ceil(Math.max(width, height) / 1600)
  const fitWidth = Math.ceil(width / factor), fitHeight = Math.ceil(height / factor)
  const fitStride = fitWidth * channels + 1
  const fit = Buffer.alloc(fitStride * fitHeight)

  // Mirror the production displayed-pixel average. Both scales use exactly one transform.
  for (let y = 0; y < fitHeight; y++) {
    if (y % 16 === 0) await setImmediate()

    for (let x = 0; x < fitWidth; x++) {
      const xEnd = Math.min(width, (x + 1) * factor), yEnd = Math.min(height, (y + 1) * factor)
      const count = (xEnd - x * factor) * (yEnd - y * factor)

      for (let c = 0; c < channels; c++) {
        let sum = 0

        for (let sy = y * factor; sy < yEnd; sy++) for (let sx = x * factor; sx < xEnd; sx++) {
          sum += data[sy * stride + sx * channels + c + 1]!
        }

        fit[y * fitStride + x * channels + c + 1] = Math.round(sum / count)
      }
    }
  }

  return { native, fit: await encodePng(fitWidth, fitHeight, channels, fit), range, estimate }
}
