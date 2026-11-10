import { execFile } from 'node:child_process'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { readFits, type HeaderValue } from './fits.ts'

const run = promisify(execFile)

export interface StarSettings {
  readonly program: string
  readonly analyseSnr: number
}

export interface FrameStats {
  readonly stars: number | null
  readonly hfdPixels: number | null
  readonly arcsecPerPixel: number | null
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

export function readStars(stdout: string): { readonly stars: number; readonly hfdPixels: number | null } | undefined {
  const found = new Map(stdout.split('\n').map(line => line.split('=').map(part => part.trim()) as [string, string]))
  const hfd = Number(found.get('HFD_MEDIAN'))
  const stars = Number(found.get('STARS'))

  if (!Number.isInteger(stars)) return undefined

  return { stars, hfdPixels: stars > 0 && Number.isFinite(hfd) ? hfd : null }
}

export function arcsecPerPixel(header: ReadonlyMap<string, HeaderValue>): number | null {
  const number = (key: string) => Number(header.get(key))
  const binning = header.has('XBINNING') ? number('XBINNING') : 1
  const scale = header.has('SCALE') ? number('SCALE') : ((number('XPIXSZ') * binning) / number('FOCALLEN')) * 206.265

  return Number.isFinite(scale) && scale > 0 ? Math.round(scale * 1000) / 1000 : null
}

const isLight = (header: ReadonlyMap<string, HeaderValue>) => /light/i.test(String(header.get('IMAGETYP') ?? 'Light'))

export function makeFrameStats(settings: StarSettings | undefined, analyse: (program: string, path: string, snr: number) => Promise<string> = async (program, path, snr) => (await run(program, ['-f', path, '-analyse', String(snr)])).stdout) {
  return async function measure(path: string): Promise<FrameStats> {
    const fits = readFits(await readFile(path))
    const { sky, noise } = skyAndNoise(fits.pixels)
    const stars = settings !== undefined && isLight(fits.header) ? readStars(await analyse(settings.program, path, settings.analyseSnr).catch(() => '')) : undefined

    return { stars: stars?.stars ?? null, hfdPixels: stars?.hfdPixels ?? null, arcsecPerPixel: arcsecPerPixel(fits.header), sky, noise }
  }
}

export async function saveStats(path: string, stats: FrameStats) {
  const target = statsName(path)

  await writeFile(`${target}.part`, JSON.stringify(stats))
  await rename(`${target}.part`, target)
}
