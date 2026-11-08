import { readFits, type Fits, type HeaderValue } from './fits.ts'
import { encodePng } from './png.ts'

export interface PreviewSettings {
  readonly bin: number
  readonly blackSigmas: number
  readonly targetMedian: number
}

const levels = 65536
const madToSigma = 1.4826
const channels = ['R', 'G', 'B'] as const

function text(header: ReadonlyMap<string, HeaderValue>, key: string) {
  const value = header.get(key)

  return typeof value === 'string' ? value : undefined
}

function offset(header: ReadonlyMap<string, HeaderValue>, key: string) {
  const value = header.get(key)

  return typeof value === 'number' ? value : 0
}

function superpixels(fits: Fits, bin: number) {
  const pattern = text(fits.header, 'BAYERPAT')?.toUpperCase()

  if (pattern === undefined || !/^[RGB]{4}$/.test(pattern)) throw new Error('the frame has no Bayer pattern')

  const layout = [...pattern].map(letter => channels.indexOf(letter as (typeof channels)[number]))
  const xOffset = offset(fits.header, 'XBAYROFF')
  const yOffset = offset(fits.header, 'YBAYROFF')
  const cell = bin * 2
  const width = Math.floor(fits.width / cell)
  const height = Math.floor(fits.height / cell)
  const planes = channels.map(() => new Uint16Array(width * height))

  for (let oy = 0; oy < height; oy += 1) {
    for (let ox = 0; ox < width; ox += 1) {
      const sums = [0, 0, 0]
      const counts = [0, 0, 0]

      for (let y = oy * cell; y < (oy + 1) * cell; y += 1) {
        for (let x = ox * cell; x < (ox + 1) * cell; x += 1) {
          const channel = layout[((y + yOffset) & 1) * 2 + ((x + xOffset) & 1)] ?? 0

          sums[channel] = (sums[channel] ?? 0) + (fits.pixels[y * fits.width + x] ?? 0)
          counts[channel] = (counts[channel] ?? 0) + 1
        }
      }

      channels.forEach((_, channel) => {
        const plane = planes[channel]

        if (plane !== undefined) plane[oy * width + ox] = Math.round((sums[channel] ?? 0) / Math.max(1, counts[channel] ?? 0))
      })
    }
  }

  return { width, height, planes }
}

function medianOf(histogram: Uint32Array, total: number) {
  let seen = 0

  for (let level = 0; level < histogram.length; level += 1) {
    seen += histogram[level] ?? 0
    if (seen * 2 >= total) return level
  }

  return histogram.length - 1
}

function midtones(balance: number, value: number) {
  if (value <= 0) return 0
  if (value >= 1) return 1

  return ((balance - 1) * value) / ((2 * balance - 1) * value - balance)
}

function stretch(plane: Uint16Array, settings: PreviewSettings) {
  const histogram = new Uint32Array(levels)

  for (const value of plane) histogram[value] = (histogram[value] ?? 0) + 1

  const median = medianOf(histogram, plane.length)
  const deviations = new Uint32Array(levels)

  for (let level = 0; level < levels; level += 1) {
    const count = histogram[level] ?? 0

    if (count > 0) deviations[Math.abs(level - median)] = (deviations[Math.abs(level - median)] ?? 0) + count
  }

  const sigma = madToSigma * medianOf(deviations, plane.length)
  const black = Math.max(0, median - settings.blackSigmas * sigma)
  const range = levels - 1 - black
  const balance = midtones(settings.targetMedian, Math.max(0, (median - black) / range))
  const table = new Uint8Array(levels)

  for (let level = 0; level < levels; level += 1) table[level] = Math.round(255 * midtones(balance, Math.max(0, (level - black) / range)))

  return table
}

export function makePreview(bytes: Buffer, settings: PreviewSettings) {
  const fits = readFits(bytes)
  const { width, height, planes } = superpixels(fits, settings.bin)
  const tables = planes.map(plane => stretch(plane, settings))
  const topDown = text(fits.header, 'ROWORDER')?.toUpperCase() === 'TOP-DOWN'
  const rgb = new Uint8Array(width * height * 3)

  for (let row = 0; row < height; row += 1) {
    const source = topDown ? row : height - 1 - row

    for (let column = 0; column < width; column += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        rgb[(row * width + column) * 3 + channel] = tables[channel]?.[planes[channel]?.[source * width + column] ?? 0] ?? 0
      }
    }
  }

  return encodePng(width, height, rgb)
}
