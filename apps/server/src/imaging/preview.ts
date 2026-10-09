import { createDisplayStretch } from './display-stretch.js'
import { encodePng } from './png.js'
import { bayerPixel, type BayerPattern } from './bayer.js'
import { setImmediate } from 'node:timers/promises'
import { backgroundOffsets, linkedRange } from './background.js'

/** A display stretch at native dimensions; acquisition pixels remain unchanged. */
export type ImageColor = { kind: 'mono' } | { kind: 'bayer'; pattern: BayerPattern }

/** Stretched 8-bit display rows in PNG layout: each row starts with filter byte 0. */
export interface StretchedImage {
  readonly width: number
  readonly height: number
  readonly channels: number
  readonly data: Buffer
}

export interface ImageRegion {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export async function previewPng(
  width: number,
  height: number,
  pixels: ArrayLike<number>,
  color: ImageColor = { kind: 'mono' },
): Promise<Buffer> {
  return nativePng(await stretchImage(width, height, pixels, color))
}

export async function capturePreviews(
  width: number,
  height: number,
  pixels: ArrayLike<number>,
  color: ImageColor = { kind: 'mono' },
) {
  const image = await stretchImage(width, height, pixels, color)
  const native = await nativePng(image)
  const factor = fitFactor(width, height)

  if (factor <= 1) return { native, fit: undefined }

  return { native, fit: await fitPng(image, factor) }
}

/** Native pixels averaged per fit pixel; a fit dimension of at most 1600 pixels. */
export function fitFactor(width: number, height: number) {
  return Math.max(1, Math.ceil(Math.max(width, height) / 1600))
}

export function nativePng(image: StretchedImage) {
  return encodePng(image.width, image.height, image.channels, image.data)
}

/** Each fit pixel averages the displayed native pixels in its factor × factor block. */
export async function fitPng(image: StretchedImage, factor: number, signal?: AbortSignal) {
  if (factor <= 1) return nativePng(image)

  const { width, height, channels, data } = image
  const fitWidth = Math.ceil(width / factor)
  const fitHeight = Math.ceil(height / factor)
  const fitStride = fitWidth * channels + 1
  const nativeStride = width * channels + 1
  const fitted = Buffer.alloc(fitStride * fitHeight)

  // Average displayed pixels so narrow stars contribute even between sampling points.
  for (let y = 0; y < fitHeight; y++) {
    if (y % 16 === 0) await yieldTo(signal)

    for (let x = 0; x < fitWidth; x++) {
      const xEnd = Math.min(width, (x + 1) * factor)
      const yEnd = Math.min(height, (y + 1) * factor)
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

  return encodePng(fitWidth, fitHeight, channels, fitted)
}

/** The same displayed native pixels within an integer region of the image. */
export function regionPng(image: StretchedImage, region: ImageRegion) {
  const { width, height, channels, data } = image

  if (
    ![region.x, region.y, region.width, region.height].every(Number.isInteger) ||
    region.x < 0 ||
    region.y < 0 ||
    region.width < 1 ||
    region.height < 1 ||
    region.x + region.width > width ||
    region.y + region.height > height
  )
    throw new RangeError('Image region must lie within the image')

  const nativeStride = width * channels + 1
  const regionStride = region.width * channels + 1
  const cropped = Buffer.alloc(regionStride * region.height)

  for (let y = 0; y < region.height; y++) {
    const start = (region.y + y) * nativeStride + region.x * channels + 1
    data.copy(cropped, y * regionStride + 1, start, start + region.width * channels)
  }

  return encodePng(region.width, region.height, channels, cropped)
}

export async function stretchImage(
  width: number,
  height: number,
  pixels: ArrayLike<number>,
  color: ImageColor = { kind: 'mono' },
  signal?: AbortSignal,
): Promise<StretchedImage> {
  const range = linkedRange(pixels)
  const { offsets } = backgroundOffsets({ width, height, pixels, color }, range)
  const display = await createDisplayStretch(range.black, range.ceiling)
  const channels = color.kind === 'bayer' ? 3 : 1
  const stride = width * channels + 1
  const data = Buffer.alloc(stride * height)

  for (let y = 0; y < height; y++) {
    // Full-resolution cameras need seconds of work; keep rig status requests responsive.
    if (y % 16 === 0) await yieldTo(signal)

    for (let x = 0; x < width; x++) {
      const rgb =
        color.kind === 'bayer'
          ? bayerPixel(width, height, pixels, color.pattern, x, y)
          : [pixels[y * width + x]!]

      for (let channel = 0; channel < channels; channel++) {
        data[y * stride + x * channels + channel + 1] = display(rgb[channel]! - offsets[channel]!)
      }
    }
  }

  return { width, height, channels, data }
}

async function yieldTo(signal: AbortSignal | undefined) {
  await setImmediate()
  signal?.throwIfAborted()
}
