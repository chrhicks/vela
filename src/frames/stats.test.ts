import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { syntheticFits } from '../testing/fits.ts'
import { arcsecPerPixel, makeFrameStats, readStars, saveStats, skyAndNoise, statsName } from './stats.ts'

let directory = ''

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vela-stats-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('frame statistics', () => {
  it('takes the sky as the median and the noise as the spread around it', () => {
    const pixels = Uint16Array.from([100, 101, 99, 100, 102, 98, 100, 60000, 100])

    expect(skyAndNoise(pixels)).toEqual({ sky: 100, noise: 1.5 })
  })

  it("reads ASTAP's star count and median HFD, with no HFD when no star was found", () => {
    expect(readStars('HFD_MEDIAN=5.5\nSTARS=251\n')).toEqual({ stars: 251, hfdPixels: 5.5 })
    expect(readStars('HFD_MEDIAN=99\nSTARS=0\n')).toEqual({ stars: 0, hfdPixels: null })
    expect(readStars('')).toBeUndefined()
  })

  it('gives the plate scale from SCALE, or from the pixel size and focal length', () => {
    expect(arcsecPerPixel(new Map([['SCALE', 1.94]]))).toBe(1.94)
    expect(arcsecPerPixel(new Map([['XPIXSZ', 3.76], ['FOCALLEN', 400]]))).toBe(1.939)
    expect(arcsecPerPixel(new Map())).toBeNull()
  })

  it('counts stars in a light frame, not in a dark, and always gives sky and noise', async () => {
    const asked: string[] = []
    const measure = makeFrameStats({ program: 'astap_cli', analyseSnr: 10 }, async (_program, path) => {
      asked.push(path)
      return 'HFD_MEDIAN=2.8\nSTARS=693\n'
    })
    const light = join(directory, 'light.fits')
    const dark = join(directory, 'dark.fits')

    await writeFile(light, syntheticFits({ width: 4, height: 4, pixel: () => 1200, extra: { IMAGETYP: 'Light Frame', SCALE: 1.94 } }))
    await writeFile(dark, syntheticFits({ width: 4, height: 4, pixel: () => 500, extra: { IMAGETYP: 'Dark Frame' } }))

    expect(await measure(light)).toEqual({ stars: 693, hfdPixels: 2.8, arcsecPerPixel: 1.94, sky: 1200, noise: 0 })
    expect(await measure(dark)).toEqual({ stars: null, hfdPixels: null, arcsecPerPixel: null, sky: 500, noise: 0 })
    expect(asked).toEqual([light])
  })

  it('saves the statistics next to the frame', async () => {
    const path = join(directory, 'a_001.fits')

    await saveStats(path, { stars: 1, hfdPixels: 2, arcsecPerPixel: null, sky: 3, noise: 4 })

    expect(JSON.parse(await readFile(statsName(path), 'utf8'))).toEqual({ stars: 1, hfdPixels: 2, arcsecPerPixel: null, sky: 3, noise: 4 })
  })
})
