import { deflate } from 'node:zlib'
import { promisify } from 'node:util'
import { setImmediate } from 'node:timers/promises'

const compress = promisify(deflate)

/** A display stretch at native dimensions; acquisition pixels remain unchanged. */
export type ImageColor = { kind: 'mono' } | { kind: 'bayer', pattern: 'rggb' | 'grbg' | 'gbrg' | 'bggr' }

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
  const channels = color.kind === 'bayer' ? 3 : 1
  const stride = width * channels + 1
  const data = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    // Full-resolution cameras need seconds of work; keep rig status requests responsive.
    if (y % 16 === 0) await setImmediate()
    for (let x = 0; x < width; x++) {
      const rgb = color.kind === 'bayer' ? bayerPixel(width, height, pixels, color.pattern, x, y) : [pixels[y * width + x]!]
      for (let channel = 0; channel < channels; channel++) {
        const value = Math.max(0, (rgb[channel]! - blackPoint) / (ceiling - blackPoint))
        data[y * stride + x * channels + channel + 1] = Math.min(255, Math.round(255 * Math.asinh(value * 10) / Math.asinh(10)))
      }
    }
  }
  return { data, channels }
}

async function encodePng(width: number, height: number, channels: number, data: Buffer) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = channels === 3 ? 2 : 0
  const compressed = await compress(data)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), await chunk('IHDR', header), await chunk('IDAT', compressed), await chunk('IEND', Buffer.alloc(0))])
}

/** Bilinear interpolation uses only in-frame neighbors, including at corners. */
function bayerPixel(width: number, height: number, pixels: ArrayLike<number>, pattern: string, x: number, y: number): number[] {
  const values = [0, 0, 0]
  const counts = [0, 0, 0]
  const channelAt = (px: number, py: number) => 'rgb'.indexOf(pattern[(py % 2) * 2 + px % 2]!)
  const ownChannel = channelAt(x, y)
  values[ownChannel] = pixels[y * width + x]!
  counts[ownChannel] = 1
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const px = x + dx, py = y + dy
      if (px < 0 || py < 0 || px >= width || py >= height) continue
      const channel = channelAt(px, py)
      if (channel === ownChannel) continue
      values[channel]! += pixels[py * width + px]!
      counts[channel]!++
    }
  }
  return values.map((value, channel) => counts[channel] ? value / counts[channel]! : pixels[y * width + x]!)
}

async function chunk(type: string, data: Buffer): Promise<Buffer> {
  const payload = Buffer.concat([Buffer.from(type), data])
  let crc = 0xffffffff
  for (let index = 0; index < payload.length; index++) {
    if (index % 1_048_576 === 0) await setImmediate()
    const byte = payload[index]!
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
  return Buffer.concat([length, payload, checksum])
}
