import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { syntheticFits } from '../testing/fits.ts'
import { arcsecPerPixel, fieldHeightDegrees, makeFrameStats, readSolution, readStarList, saveStats, shapeOf, skyAndNoise, statsName } from './stats.ts'

let directory = ''

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vela-stats-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

const shape = { shapeMinSnr: 30, shapeStars: 300, saturated: 60000 }
const settings = { program: 'astap_cli', analyseSnr: 10, listLimit: 10000, solveRadiusDegrees: 2, ...shape }

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
    const measure = makeFrameStats(settings, async (_program, path, snr, limit) => {
      asked.push(`${path} ${snr} ${limit}`)
      return 'x,y,hfd,snr,flux\n21,21,2.8,100,1000\n10,10,3.0,12,10\n'
    })
    const light = join(directory, 'light.fits')
    const dark = join(directory, 'dark.fits')

    await writeFile(light, syntheticFits({ width: 40, height: 40, pixel: (x, y) => Math.round(500 + round(x, y)), extra: { IMAGETYP: 'Light Frame', SCALE: 1.94 } }))
    await writeFile(dark, syntheticFits({ width: 4, height: 4, pixel: () => 500, extra: { IMAGETYP: 'Dark Frame' } }))

    expect(await measure(light)).toMatchObject({ stars: 2, hfdPixels: 2.8, arcsecPerPixel: 1.94, shapedStars: 1, sky: 500 })
    expect((await measure(light)).elongation).toBeCloseTo(1, 1)
    expect(await measure(dark)).toEqual({ centre: null, solution: null, stars: null, hfdPixels: null, arcsecPerPixel: null, elongation: null, shapedStars: 0, sky: 500, noise: 0 })
    expect(asked).toEqual([`${light} 10 10000`, `${light} 10 10000`])
  })

  it("plate solves a light frame near the mount's pointing in its header, when a star database is set", async () => {
    const solved: string[] = []
    const measure = makeFrameStats({ ...settings, catalog: '/catalog' }, async () => 'x,y,hfd,snr,flux\n21,21,2.8,100,1000\n', async (program, catalog, path, near, radiusDegrees, fieldDegrees) => {
      solved.push(`${program} ${catalog} ${path} ${near.raDegrees} ${near.decDegrees} ${radiusDegrees} ${fieldDegrees?.toFixed(3)}`)
      return 'PLTSOLVD=T\nCRVAL1= 2.3459289749219220E+001\nCRVAL2= 3.0648188779510235E+001\nCRPIX1= 3124.5\nCRPIX2= 2088.5\nCD1_1= 1.786e-4\nCD1_2= 5.052e-4\nCD2_1= -5.051e-4\nCD2_2= 1.784e-4\n'
    })
    const pointed = join(directory, 'pointed.fits')
    const unpointed = join(directory, 'unpointed.fits')

    await writeFile(pointed, syntheticFits({ width: 40, height: 40, pixel: (x, y) => Math.round(500 + round(x, y)), extra: { IMAGETYP: 'Light Frame', RA: 23.45079, DEC: 30.64996, YPIXSZ: 3.76, FOCALLEN: 400 } }))
    await writeFile(unpointed, syntheticFits({ width: 40, height: 40, pixel: (x, y) => Math.round(500 + round(x, y)), extra: { IMAGETYP: 'Light Frame' } }))

    expect((await measure(pointed)).centre).toEqual({ raDegrees: 23.45928974921922, decDegrees: 30.648188779510235 })
    expect((await measure(unpointed)).centre).toBeNull()
    expect((await makeFrameStats(settings, async () => '', async () => 'PLTSOLVD=T')(pointed)).centre).toBeNull()
    expect(solved).toEqual([`astap_cli /catalog ${pointed} 23.45079 30.64996 2 0.022`])
  })

  it("reads ASTAP's solution, and nothing from a frame it could not solve or that lacks the pixel scale", () => {
    expect(readSolution('PLTSOLVD=T\r\nCRPIX1= 3.1245000000000000E+003\r\nCRPIX2= 2.0885000000000000E+003\r\nCRVAL1= 2.3459289749219220E+001\r\nCRVAL2= 3.0648188779510235E+001\r\nCROTA2=-7.0551224671978517E+001\r\nCD1_1= 1.7864279971656184E-004\r\nCD1_2= 5.0522612662452055E-004\r\nCD2_1=-5.0512286386245552E-004\r\nCD2_2= 1.7836531801028712E-004\r\n')).toEqual({ centre: { raDegrees: 23.45928974921922, decDegrees: 30.648188779510235 }, referencePixel: [3124.5, 2088.5], matrix: [[1.7864279971656184e-4, 5.0522612662452055e-4], [-5.0512286386245552e-4, 1.7836531801028712e-4]] })
    expect(readSolution('PLTSOLVD=T\nCRVAL1= 23.4\nCRVAL2= 30.6\n')).toBeNull()
    expect(readSolution('PLTSOLVD=F\nERROR=No star database found.\n')).toBeNull()
    expect(readSolution('')).toBeNull()
  })

  it('saves the statistics next to the frame', async () => {
    const path = join(directory, 'a_001.fits')
    const stats = { centre: null, solution: null, stars: 1, hfdPixels: 2, arcsecPerPixel: null, elongation: 1.04, shapedStars: 1, sky: 3, noise: 4 }

    await saveStats(path, stats)

    expect(JSON.parse(await readFile(statsName(path), 'utf8'))).toEqual(stats)
  })

  it('gives the height of the field from the pixel size, the rows and the focal length', () => {
    expect(fieldHeightDegrees(new Map([['YPIXSZ', 3.76], ['FOCALLEN', 400]]), 4176)?.toFixed(3)).toBe('2.249')
    expect(fieldHeightDegrees(new Map([['XPIXSZ', 3.76], ['FOCALLEN', 400]]), 4176)?.toFixed(3)).toBe('2.249')
    expect(fieldHeightDegrees(new Map([['XPIXSZ', 3.76]]), 4176)).toBeUndefined()
  })
})
