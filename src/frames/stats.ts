import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Schema } from 'effect'
import { SkyPosition } from '../../state/entries.ts'
import { readFits, type HeaderValue } from './fits.ts'

const run = promisify(execFile)

export interface StarSettings {
  readonly program: string
  readonly catalog?: string
  readonly solveRadiusDegrees: number
  readonly analyseSnr: number
  readonly listLimit: number
  readonly shapeMinSnr: number
  readonly shapeStars: number
  readonly saturated: number
}

const Pair = Schema.Tuple([Schema.Number, Schema.Number])

export const PlateSolution = Schema.Struct({ centre: SkyPosition, referencePixel: Pair, matrix: Schema.Tuple([Pair, Pair]) })

export type PlateSolution = typeof PlateSolution.Type

export interface FrameStats {
  readonly centre: SkyPosition | null
  readonly solution: PlateSolution | null
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

function medianAndSpread(pixels: Uint16Array, take: (index: number) => boolean): { readonly sky: number; readonly noise: number } {
  const counts = new Uint32Array(65536)
  let length = 0

  for (let index = 0; index < pixels.length; index += 1) {
    if (!take(index)) continue
    counts[pixels[index]!]! += 1
    length += 1
  }

  const pixelsCounted = length

  const middle = (pixelsCounted + 1) / 2
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

  return { sky, noise: at(middle, deviations) * madToSigma }
}

export function skyAndNoise(pixels: Uint16Array, width = pixels.length, bayer = false): { readonly sky: number; readonly noise: number } {
  const whole = medianAndSpread(pixels, () => true)

  if (!bayer) return { sky: whole.sky, noise: Math.round(whole.noise * 10) / 10 }

  const colours = [0, 1, 2, 3].map(cell => medianAndSpread(pixels, index => ((Math.floor(index / width) % 2) * 2 + (index % width) % 2) === cell).noise).sort((a, b) => a - b)

  return { sky: whole.sky, noise: Math.round(((colours[1]! + colours[2]!) / 2) * 10) / 10 }
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
  const elongations: number[] = []

  for (const star of [...stars].filter(candidate => candidate.snr >= settings.shapeMinSnr).sort((a, b) => b.flux - a.flux)) {
    if (elongations.length >= settings.shapeStars) break

    const elongation = elongationOf(star, image, settings.saturated)

    if (elongation !== undefined) elongations.push(elongation)
  }

  const typical = median(elongations)

  return { elongation: typical === undefined ? null : Math.round(typical * 100) / 100, shapedStars: elongations.length }
}

export function arcsecPerPixel(header: ReadonlyMap<string, HeaderValue>): number | null {
  const number = (key: string) => Number(header.get(key))
  const binning = header.has('XBINNING') ? number('XBINNING') : 1
  const scale = header.has('SCALE') ? number('SCALE') : ((number('XPIXSZ') * binning) / number('FOCALLEN')) * 206.265

  return Number.isFinite(scale) && scale > 0 ? Math.round(scale * 1000) / 1000 : null
}

export const isLight = (header: ReadonlyMap<string, HeaderValue>) => /light/i.test(String(header.get('IMAGETYP') ?? 'Light'))

export async function listStars(program: string, path: string, snr: number, limit: number): Promise<string> {
  const csv = path.replace(/\.fits$/, '.csv')

  try {
    await run(program, ['-f', path, '-extract', String(snr), '-s', String(limit)])

    return await readFile(csv, 'utf8')
  } finally {
    await rm(csv, { force: true })
  }
}

export const pointingOf = (header: ReadonlyMap<string, HeaderValue>): SkyPosition | undefined => {
  const ra = header.get('RA')
  const dec = header.get('DEC')

  return typeof ra === 'number' && typeof dec === 'number' ? { raDegrees: ra, decDegrees: dec } : undefined
}

export function readSolution(ini: string): PlateSolution | null {
  const values = new Map(ini.split(/\r?\n/).flatMap(line => {
    const at = line.indexOf('=')

    return at < 0 ? [] : [[line.slice(0, at).trim(), line.slice(at + 1).trim()] as const]
  }))
  const numbers = ['CRVAL1', 'CRVAL2', 'CRPIX1', 'CRPIX2', 'CD1_1', 'CD1_2', 'CD2_1', 'CD2_2'].map(key => Number(values.get(key)))
  const [raDegrees = NaN, decDegrees = NaN, x = NaN, y = NaN, a = NaN, b = NaN, c = NaN, d = NaN] = numbers

  if (values.get('PLTSOLVD') !== 'T' || !numbers.every(Number.isFinite)) return null

  return { centre: { raDegrees, decDegrees }, referencePixel: [x, y], matrix: [[a, b], [c, d]] }
}

export function fieldHeightDegrees(header: ReadonlyMap<string, HeaderValue>, rows: number): number | undefined {
  const number = (key: string) => Number(header.get(key))
  const focalLength = number('FOCALLEN')
  if (!(focalLength > 0)) return undefined
  const millimetres = (rows * (header.has('YPIXSZ') ? number('YPIXSZ') : number('XPIXSZ'))) / 1000
  const degrees = (2 * Math.atan(millimetres / 2 / focalLength) * 180) / Math.PI

  return Number.isFinite(degrees) && degrees > 0 ? degrees : undefined
}

export type Solve = (program: string, catalog: string, path: string, near: SkyPosition, radiusDegrees: number, fieldDegrees: number | undefined) => Promise<string>

export async function solveFrame(program: string, catalog: string, path: string, near: SkyPosition, radiusDegrees: number, fieldDegrees: number | undefined): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'vela-solve-'))
  const base = join(directory, 'solved')

  try {
    await run(program, ['-f', path, '-o', base, '-ra', String(near.raDegrees / 15), '-spd', String(near.decDegrees + 90), '-r', String(radiusDegrees), '-fov', fieldDegrees === undefined ? '0' : fieldDegrees.toFixed(3), '-d', catalog])

    return await readFile(`${base}.ini`, 'utf8')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

export type MeasureStep = 'stars' | 'solve'

export function makeFrameStats(settings: StarSettings | undefined, failed: (step: MeasureStep, path: string, error: unknown) => void, list: (program: string, path: string, snr: number, limit: number) => Promise<string> = listStars, solve: Solve = solveFrame) {
  return async function measure(path: string): Promise<FrameStats> {
    const fits = readFits(await readFile(path))
    const { sky, noise } = skyAndNoise(fits.pixels, fits.width, typeof fits.header.get('BAYERPAT') === 'string')
    const scale = arcsecPerPixel(fits.header)

    if (settings === undefined || !isLight(fits.header)) return { centre: null, solution: null, stars: null, hfdPixels: null, arcsecPerPixel: scale, elongation: null, shapedStars: 0, sky, noise }

    const reported = (step: MeasureStep) => (error: unknown) => {
      failed(step, path, error)
      return undefined
    }
    const listed = await list(settings.program, path, settings.analyseSnr, settings.listLimit).then(readStarList, reported('stars'))
    const stars = listed ?? []
    const hfd = median(stars.map(star => star.hfd))
    const near = pointingOf(fits.header)
    const solution = settings.catalog === undefined || near === undefined ? null : ((await solve(settings.program, settings.catalog, path, near, settings.solveRadiusDegrees, fieldHeightDegrees(fits.header, fits.height)).then(readSolution, reported('solve'))) ?? null)

    return { centre: solution?.centre ?? null, solution, stars: listed === undefined ? null : listed.length, hfdPixels: hfd === undefined ? null : Math.round(hfd * 100) / 100, arcsecPerPixel: scale, ...shapeOf(stars, fits, settings), sky, noise }
  }
}

export async function saveStats(path: string, stats: FrameStats) {
  const target = statsName(path)

  await writeFile(`${target}.part`, JSON.stringify(stats))
  await rename(`${target}.part`, target)
}
