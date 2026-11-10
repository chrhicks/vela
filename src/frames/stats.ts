import { execFile } from 'node:child_process'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { readFits, type HeaderValue } from './fits.ts'

const run = promisify(execFile)

export interface StarSettings {
  readonly program: string
  readonly analyseSnr: number
  readonly shapeMinSnr: number
  readonly shapeStars: number
  readonly saturated: number
}

export interface FrameStats {
  readonly stars: number | null
  readonly hfdPixels: number | null
  readonly arcsecPerPixel: number | null
  readonly elongation: number | null
  readonly shapedStars: number
  readonly sky: number
  readonly noise: number
}

export const statsName = (file: string) => `${file}.stats.json`

const madToSigma = 1.4826

export function skyAndNoise(pixels: Uint16Array): { readonly sky: number; readonly noise: number } {
  const counts = new Uint32Array(65536)

  for (const value of pixels) counts[value]! += 1

  const middle = (pixels.length + 1) / 2
  const at = (rank: number, histogram: ArrayLike<number>) => {
    let seen = 0

    for (let value = 0; value < histogram.length; value += 1) {
      seen += histogram[value]!
      if (seen >= rank) return value
    }

    return histogram.length - 1
  }
  const sky = at(middle, counts)
  const deviations = new Uint32Array(65536)

  for (let value = 0; value < counts.length; value += 1) if (counts[value]! > 0) deviations[Math.abs(value - sky)]! += counts[value]!

  return { sky, noise: Math.round(at(middle, deviations) * madToSigma * 10) / 10 }
}

export interface ListedStar {
  readonly x: number
  readonly y: number
  readonly hfd: number
  readonly snr: number
  readonly flux: number
}

export function readStarList(csv: string): ReadonlyArray<ListedStar> {
  return csv
    .trim()
    .split('\n')
    .slice(1)
    .map(line => line.split(',').map(Number))
    .filter(values => values.length >= 5 && values.slice(0, 5).every(Number.isFinite))
    .map(([x, y, hfd, snr, flux]) => ({ x: x!, y: y!, hfd: hfd!, snr: snr!, flux: flux! }))
}

const median = (values: ReadonlyArray<number>) => {
  const sorted = [...values].sort((a, b) => a - b)

  return sorted.length === 0 ? undefined : sorted[(sorted.length - 1) >> 1]
}

const windowPerHfd = 2.5
const smallestWindow = 5
const ringWidth = 3

function elongationOf(star: ListedStar, image: { readonly width: number; readonly height: number; readonly pixels: Uint16Array }, saturated: number): number | undefined {
  const { width, height, pixels } = image
  const cx = Math.round(star.x - 1)
  const cy = Math.round(star.y - 1)
  const radius = Math.max(smallestWindow, Math.ceil(windowPerHfd * star.hfd))
  const outer = radius + ringWidth

  if (cx - outer < 0 || cy - outer < 0 || cx + outer >= width || cy + outer >= height) return undefined

  const ring: number[] = []
  const inside: Array<readonly [number, number, number]> = []

  for (let dy = -outer; dy <= outer; dy += 1) {
    for (let dx = -outer; dx <= outer; dx += 1) {
      const distance = Math.hypot(dx, dy)
      const value = pixels[(cy + dy) * width + cx + dx]!

      if (distance <= radius) {
        if (value >= saturated) return undefined
        inside.push([dx, dy, value])
      } else if (distance <= outer) ring.push(value)
    }
  }

  const background = median(ring)!
  let total = 0
  let sumX = 0
  let sumY = 0

  for (const [dx, dy, value] of inside) {
    const weight = Math.max(0, value - background)

    total += weight
    sumX += weight * dx
    sumY += weight * dy
  }

  if (total <= 0) return undefined

  const [meanX, meanY] = [sumX / total, sumY / total]
  let xx = 0
  let yy = 0
  let xy = 0

  for (const [dx, dy, value] of inside) {
    const weight = Math.max(0, value - background)

    xx += weight * (dx - meanX) ** 2
    yy += weight * (dy - meanY) ** 2
    xy += weight * (dx - meanX) * (dy - meanY)
  }

  const half = (xx + yy) / 2 / total
  const spread = Math.hypot((xx - yy) / 2 / total, xy / total)

  return half - spread > 0 ? Math.sqrt((half + spread) / (half - spread)) : undefined
}

export function shapeOf(stars: ReadonlyArray<ListedStar>, image: { readonly width: number; readonly height: number; readonly pixels: Uint16Array }, settings: Pick<StarSettings, 'shapeMinSnr' | 'shapeStars' | 'saturated'>) {
  const elongations = [...stars]
    .filter(star => star.snr >= settings.shapeMinSnr)
    .sort((a, b) => b.flux - a.flux)
    .slice(0, settings.shapeStars)
    .map(star => elongationOf(star, image, settings.saturated))
    .filter((value): value is number => value !== undefined)
  const typical = median(elongations)

  return { elongation: typical === undefined ? null : Math.round(typical * 100) / 100, shapedStars: elongations.length }
}

export function arcsecPerPixel(header: ReadonlyMap<string, HeaderValue>): number | null {
  const number = (key: string) => Number(header.get(key))
  const binning = header.has('XBINNING') ? number('XBINNING') : 1
  const scale = header.has('SCALE') ? number('SCALE') : ((number('XPIXSZ') * binning) / number('FOCALLEN')) * 206.265

  return Number.isFinite(scale) && scale > 0 ? Math.round(scale * 1000) / 1000 : null
}

const isLight = (header: ReadonlyMap<string, HeaderValue>) => /light/i.test(String(header.get('IMAGETYP') ?? 'Light'))

export async function listStars(program: string, path: string, snr: number): Promise<string> {
  const csv = path.replace(/\.fits$/, '.csv')

  try {
    await run(program, ['-f', path, '-extract', String(snr)])

    return await readFile(csv, 'utf8')
  } finally {
    await rm(csv, { force: true })
  }
}

export function makeFrameStats(settings: StarSettings | undefined, list: (program: string, path: string, snr: number) => Promise<string> = listStars) {
  return async function measure(path: string): Promise<FrameStats> {
    const fits = readFits(await readFile(path))
    const { sky, noise } = skyAndNoise(fits.pixels)
    const scale = arcsecPerPixel(fits.header)

    if (settings === undefined || !isLight(fits.header)) return { stars: null, hfdPixels: null, arcsecPerPixel: scale, elongation: null, shapedStars: 0, sky, noise }

    const stars = readStarList(await list(settings.program, path, settings.analyseSnr).catch(() => ''))
    const hfd = median(stars.map(star => star.hfd))

    return { stars: stars.length, hfdPixels: hfd === undefined ? null : Math.round(hfd * 100) / 100, arcsecPerPixel: scale, ...shapeOf(stars, fits, settings), sky, noise }
  }
}

export async function saveStats(path: string, stats: FrameStats) {
  const target = statsName(path)

  await writeFile(`${target}.part`, JSON.stringify(stats))
  await rename(`${target}.part`, target)
}
