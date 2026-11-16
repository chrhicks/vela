import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { syntheticFits } from '../testing/fits.ts'
import { arcsecPerPixel, makeFrameStats, readSolution, readStarList, saveStats, shapeOf, skyAndNoise, statsName } from './stats.ts'

let directory = ''

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vela-stats-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

const shape = { shapeMinSnr: 30, shapeStars: 300, saturated: 60000 }
const settings = { program: 'astap_cli', analyseSnr: 10, solveRadiusDegrees: 2, ...shape }

function star(x: number, y: number, sigmaX: number, sigmaY: number) {
  return (px: number, py: number) => 20000 * Math.exp(-((px - x) ** 2) / (2 * sigmaX ** 2) - (py - y) ** 2 / (2 * sigmaY ** 2))
}

const round = star(20, 20, 2, 2)
const stretched = star(60, 20, 4, 2)
const image = (pixel: (x: number, y: number) => number) => ({ width: 80, height: 40, pixels: Uint16Array.from({ length: 80 * 40 }, (_, index) => Math.round(500 + pixel(index % 80, Math.floor(index / 80)))) })
const listed = (x: number, y: number, snr = 100, hfd = 3) => ({ x: x + 1, y: y + 1, hfd, snr, flux: 1000 })

describe('frame statistics', () => {
  it('takes the sky as the median and the noise as the spread around it', () => {
    expect(skyAndNoise(Uint16Array.from([100, 101, 99, 100, 102, 98, 100, 60000, 100]))).toEqual({ sky: 100, noise: 1.5 })
  })

  it('measures the noise of a colour frame within each colour, not across them', () => {
    const width = 40
    const pixels = Uint16Array.from({ length: width * 40 }, (_, index) => {
      const cell = (Math.floor(index / width) % 2) * 2 + (index % width) % 2
      return [1000, 1500, 1500, 2200][cell]! + (index % 3) - 1
    })

    expect(skyAndNoise(pixels, width, false).noise).toBeGreaterThan(300)
    expect(skyAndNoise(pixels, width, true).noise).toBe(1.5)
  })

  it("reads ASTAP's star list", () => {
    expect(readStarList('x,y,hfd,snr,flux,ra[0..360],dec[0..360]\n4146.1434,21.7917,2.4314,94,27483\n2300.4505,24.3992,2.7267,174,64364\n')).toEqual([
      { x: 4146.1434, y: 21.7917, hfd: 2.4314, snr: 94, flux: 27483 },
      { x: 2300.4505, y: 24.3992, hfd: 2.7267, snr: 174, flux: 64364 },
    ])
    expect(readStarList('')).toEqual([])
  })

  it('measures a round star near 1 and a star twice as long as it is wide near 2', () => {
    expect(shapeOf([listed(20, 20)], image(round), shape).elongation).toBeCloseTo(1, 1)
    expect(shapeOf([listed(60, 20, 100, 6)], image(stretched), shape).elongation).toBeCloseTo(2, 1)
  })

  it('goes past saturated bright stars to measure the next ones', () => {
    const bright = { ...listed(20, 20), flux: 9000 }
    const fainter = { ...listed(60, 20, 100, 6), flux: 100 }
    const both = image((x, y) => (x < 40 ? round(x, y) * 4 : stretched(x, y)))

    expect(shapeOf([bright, fainter], both, { ...shape, shapeStars: 1 })).toEqual({ elongation: 2, shapedStars: 1 })
  })

  it('leaves out weak, saturated and edge stars, and gives no elongation without any left', () => {
    expect(shapeOf([listed(20, 20, 10)], image(round), shape)).toEqual({ elongation: null, shapedStars: 0 })
    expect(shapeOf([listed(20, 20)], image((x, y) => round(x, y) * 4), shape)).toEqual({ elongation: null, shapedStars: 0 })
    expect(shapeOf([listed(2, 20)], image(round), shape)).toEqual({ elongation: null, shapedStars: 0 })
  })

  it('gives the plate scale from SCALE, or from the pixel size and focal length', () => {
    expect(arcsecPerPixel(new Map([['SCALE', 1.94]]))).toBe(1.94)
    expect(arcsecPerPixel(new Map([['XPIXSZ', 3.76], ['FOCALLEN', 400]]))).toBe(1.939)
    expect(arcsecPerPixel(new Map())).toBeNull()
  })

  it('lists stars in a light frame, not in a dark, and always gives sky and noise', async () => {
    const asked: string[] = []
    const measure = makeFrameStats(settings, async (_program, path) => {
      asked.push(path)
      return 'x,y,hfd,snr,flux\n21,21,2.8,100,1000\n10,10,3.0,12,10\n'
    })
    const light = join(directory, 'light.fits')
    const dark = join(directory, 'dark.fits')

    await writeFile(light, syntheticFits({ width: 40, height: 40, pixel: (x, y) => Math.round(500 + round(x, y)), extra: { IMAGETYP: 'Light Frame', SCALE: 1.94 } }))
    await writeFile(dark, syntheticFits({ width: 4, height: 4, pixel: () => 500, extra: { IMAGETYP: 'Dark Frame' } }))

    expect(await measure(light)).toMatchObject({ stars: 2, hfdPixels: 2.8, arcsecPerPixel: 1.94, shapedStars: 1, sky: 500 })
    expect((await measure(light)).elongation).toBeCloseTo(1, 1)
    expect(await measure(dark)).toEqual({ centre: null, stars: null, hfdPixels: null, arcsecPerPixel: null, elongation: null, shapedStars: 0, sky: 500, noise: 0 })
    expect(asked).toEqual([light, light])
  })

  it("plate solves a light frame near the mount's pointing in its header, when a star database is set", async () => {
    const solved: string[] = []
    const measure = makeFrameStats({ ...settings, catalog: '/catalog' }, async () => 'x,y,hfd,snr,flux\n21,21,2.8,100,1000\n', async (program, catalog, path, near, radiusDegrees) => {
      solved.push(`${program} ${catalog} ${path} ${near.raDegrees} ${near.decDegrees} ${radiusDegrees}`)
      return 'PLTSOLVD=T\nCRVAL1= 2.3459289749219220E+001\nCRVAL2= 3.0648188779510235E+001\n'
    })
    const pointed = join(directory, 'pointed.fits')
    const unpointed = join(directory, 'unpointed.fits')

    await writeFile(pointed, syntheticFits({ width: 40, height: 40, pixel: (x, y) => Math.round(500 + round(x, y)), extra: { IMAGETYP: 'Light Frame', RA: 23.45079, DEC: 30.64996 } }))
    await writeFile(unpointed, syntheticFits({ width: 40, height: 40, pixel: (x, y) => Math.round(500 + round(x, y)), extra: { IMAGETYP: 'Light Frame' } }))

    expect((await measure(pointed)).centre).toEqual({ raDegrees: 23.45928974921922, decDegrees: 30.648188779510235 })
    expect((await measure(unpointed)).centre).toBeNull()
    expect((await makeFrameStats(settings, async () => '', async () => 'PLTSOLVD=T')(pointed)).centre).toBeNull()
    expect(solved).toEqual([`astap_cli /catalog ${pointed} 23.45079 30.64996 2`])
  })

  it("reads ASTAP's solution, and nothing from a frame it could not solve", () => {
    expect(readSolution('PLTSOLVD=T\r\nCRVAL1= 2.3459289749219220E+001\r\nCRVAL2= 3.0648188779510235E+001\r\nCROTA2=-7.0551224671978517E+001\r\n')).toEqual({ raDegrees: 23.45928974921922, decDegrees: 30.648188779510235 })
    expect(readSolution('PLTSOLVD=F\nERROR=No star database found.\n')).toBeNull()
    expect(readSolution('')).toBeNull()
  })

  it('saves the statistics next to the frame', async () => {
    const path = join(directory, 'a_001.fits')
    const stats = { centre: null, stars: 1, hfdPixels: 2, arcsecPerPixel: null, elongation: 1.04, shapedStars: 1, sky: 3, noise: 4 }

    await saveStats(path, stats)

    expect(JSON.parse(await readFile(statsName(path), 'utf8'))).toEqual(stats)
  })
})
