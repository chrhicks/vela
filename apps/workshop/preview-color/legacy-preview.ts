// Frozen A renderer from 59fa6da, retained only to reproduce the approved comparison.
import { createDisplayStretch } from '../../server/src/imaging/display-stretch.js'
import { encodePng } from '../../server/src/imaging/png.js'
import { bayerPixel } from '../../server/src/imaging/bayer.js'
import type { ImageColor } from '../../server/src/imaging/preview.js'
import { setImmediate } from 'node:timers/promises'

export async function capturePreviews(
  width: number,
  height: number,
  pixels: ArrayLike<number>,
  color: ImageColor = { kind: 'mono' },
) {
  const sampleStride = Math.max(1, Math.floor(pixels.length / 200_000) | 1)

  const sample = Array.from(
    { length: Math.ceil(pixels.length / sampleStride) },
    (_, i) => pixels[i * sampleStride]!,
  ).sort((a, b) => a - b)

  const blackPoint = sample[Math.floor(sample.length * 0.01)] ?? 0
  const ceiling = Math.max(blackPoint + 100, sample[Math.floor(sample.length * 0.999)] ?? 1000)
  const display = await createDisplayStretch(blackPoint, ceiling)
  const channels = color.kind === 'bayer' ? 3 : 1
  const nativeStride = width * channels + 1
  const data = Buffer.alloc(nativeStride * height)

  for (let y = 0; y < height; y++) {
    if (y % 16 === 0) await setImmediate()

    for (let x = 0; x < width; x++) {
      const rgb =
        color.kind === 'bayer'
          ? bayerPixel(width, height, pixels, color.pattern, x, y)
          : [pixels[y * width + x]!]

      for (let channel = 0; channel < channels; channel++) {
        data[y * nativeStride + x * channels + channel + 1] = display(rgb[channel]!)
      }
    }
  }

  const native = await encodePng(width, height, channels, data)
  const factor = Math.ceil(Math.max(width, height) / 1600)

  if (factor <= 1) return { native, fit: undefined }

  const fitWidth = Math.ceil(width / factor),
    fitHeight = Math.ceil(height / factor)

  const fitStride = fitWidth * channels + 1
  const fitted = Buffer.alloc(fitStride * fitHeight)

  for (let y = 0; y < fitHeight; y++) {
    if (y % 16 === 0) await setImmediate()

    for (let x = 0; x < fitWidth; x++) {
      const xEnd = Math.min(width, (x + 1) * factor),
        yEnd = Math.min(height, (y + 1) * factor)

      const count = (xEnd - x * factor) * (yEnd - y * factor)

      for (let channel = 0; channel < channels; channel++) {
        let sum = 0

        for (let sy = y * factor; sy < yEnd; sy++) {
          for (let sx = x * factor; sx < xEnd; sx++) {
            sum += data[sy * nativeStride + sx * channels + channel + 1]!
          }
        }

        fitted[y * fitStride + x * channels + channel + 1] = Math.round(sum / count)
      }
    }
  }

  return { native, fit: await encodePng(fitWidth, fitHeight, channels, fitted) }
}
