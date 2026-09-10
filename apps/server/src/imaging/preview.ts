import { createDisplayStretch } from './display-stretch.js'
import { encodePng } from './png.js'
import { bayerPixel, type BayerPattern } from './bayer.js'
import { setImmediate } from 'node:timers/promises'

/** A display stretch at native dimensions; acquisition pixels remain unchanged. */
export type ImageColor = { kind: 'mono' } | { kind: 'bayer', pattern: BayerPattern }

export async function previewPng(width: number, height: number, pixels: ArrayLike<number>, color: ImageColor = { kind: 'mono' }): Promise<Buffer> {
  const { data, channels } = await stretch(width, height, pixels, color)

  return encodePng(width, height, channels, data)
}

export async function capturePreviews(width: number, height: number, pixels: ArrayLike<number>, color: ImageColor = { kind: 'mono' }) {
  const { data, channels } = await stretch(width, height, pixels, color)
  const native = await encodePng(width, height, channels, data)
  const factor = Math.ceil(Math.max(width, height) / 1600)

  if (factor <= 1) return { native, fit: undefined }

  const fitWidth = Math.ceil(width / factor), fitHeight = Math.ceil(height / factor)
  const fitStride = fitWidth * channels + 1
  const nativeStride = width * channels + 1
  const fitted = Buffer.alloc(fitStride * fitHeight)

  // Average displayed pixels so narrow stars contribute even between sampling points.
  for (let y = 0; y < fitHeight; y++) {
    if (y % 16 === 0) await setImmediate()

    for (let x = 0; x < fitWidth; x++) {
      const xEnd = Math.min(width, (x + 1) * factor), yEnd = Math.min(height, (y + 1) * factor)
      const count = (xEnd - x * factor) * (yEnd - y * factor)

      for (let channel = 0; channel < channels; channel++) {
        let sum = 0

        for (let sy = y * factor; sy < yEnd; sy++) for (let sx = x * factor; sx < xEnd; sx++) {
          sum += data[sy * nativeStride + sx * channels + channel + 1]!
        }

        fitted[y * fitStride + x * channels + channel + 1] = Math.round(sum / count)
      }
    }
  }

  return { native, fit: await encodePng(fitWidth, fitHeight, channels, fitted) }
}

async function stretch(width: number, height: number, pixels: ArrayLike<number>, color: ImageColor) {
  // An odd stride samples every Bayer phase rather than just one sensor color.
  const sampleStride = Math.max(1, Math.floor(pixels.length / 200_000) | 1)
  const sample = Array.from({ length: Math.ceil(pixels.length / sampleStride) }, (_, i) => pixels[i * sampleStride]!).sort((a, b) => a - b)
  const blackPoint = sample[Math.floor(sample.length * 0.01)] ?? 0
  const ceiling = Math.max(blackPoint + 100, sample[Math.floor(sample.length * 0.999)] ?? 1000)
  const display = await createDisplayStretch(blackPoint, ceiling)
  const channels = color.kind === 'bayer' ? 3 : 1
  const stride = width * channels + 1
  const data = Buffer.alloc(stride * height)

  for (let y = 0; y < height; y++) {
    // Full-resolution cameras need seconds of work; keep rig status requests responsive.
    if (y % 16 === 0) await setImmediate()

    for (let x = 0; x < width; x++) {
      const rgb = color.kind === 'bayer' ? bayerPixel(width, height, pixels, color.pattern, x, y) : [pixels[y * width + x]!]

      for (let channel = 0; channel < channels; channel++) {
        data[y * stride + x * channels + channel + 1] = display(rgb[channel]!)
      }
    }
  }

  return { data, channels }
}
