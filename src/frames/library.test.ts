import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { syntheticFits } from '../testing/fits.ts'
import { decodePng } from '../testing/png.ts'
import { frameDetail, listNight, makePreviews } from './library.ts'

const settings = { bin: 1, blackSigmas: 2.8, targetMedian: 0.25 }

let keepDir = ''

beforeEach(async () => {
  keepDir = await mkdtemp(join(tmpdir(), 'vela-library-'))
  await mkdir(join(keepDir, '2026-11-07'))
})

afterEach(async () => {
  await rm(keepDir, { recursive: true, force: true })
})

async function keepFrame(name: string, keptAt: string, content: Buffer = Buffer.from('x')) {
  await writeFile(join(keepDir, '2026-11-07', name), content)
  await writeFile(join(keepDir, '2026-11-07', `${name}.json`), JSON.stringify({ bytes: content.length, keptAt }))
}

const frame = syntheticFits({ width: 8, height: 8, pattern: 'RGGB', rowOrder: 'TOP-DOWN', pixel: (x, y) => 1000 + ((x + y) % 3) * 50 })

describe('listNight', () => {
  it('lists the night newest first with each frame\'s measured stats, and ignores previews, partial files and stats files', async () => {
    await keepFrame('a_001.fits', '2026-11-08T03:00:00.000Z')
    await keepFrame('a_002.fits', '2026-11-08T03:05:00.000Z')
    await writeFile(join(keepDir, '2026-11-07', 'a_002.fits.png'), 'png')
    await writeFile(join(keepDir, '2026-11-07', 'a_003.fits.part'), 'half')
    await writeFile(join(keepDir, '2026-11-07', 'a_002.fits.stats.json'), JSON.stringify({ stars: 251, hfdPixels: 2.8, arcsecPerPixel: 1.94, elongation: 1.04, shapedStars: 200, sky: 1234, noise: 12 }))

    expect(await listNight(keepDir, '2026-11-07')).toEqual({
      night: '2026-11-07',
      frames: [
        { file: 'a_002.fits', bytes: 1, keptAt: '2026-11-08T03:05:00.000Z', run: null, sequence: null, frame: null, stats: { stars: 251, hfdPixels: 2.8, arcsecPerPixel: 1.94, elongation: 1.04, shapedStars: 200, sky: 1234, noise: 12 } },
        { file: 'a_001.fits', bytes: 1, keptAt: '2026-11-08T03:00:00.000Z', run: null, sequence: null, frame: null, stats: null },
      ],
    })
  })

  it('has no frames for a night with no folder', async () => {
    expect(await listNight(keepDir, '2026-11-09')).toEqual({ night: '2026-11-09', frames: [] })
  })
})

describe('frameDetail', () => {
  it('gives a kept frame\'s run, file, hash and every header card, read from the header alone', async () => {
    const sidecar = { run: 'r1', sequence: 'm31_light', frame: 2, original: '/spool/m31_light_002.fits', sha256: 'ab', bytes: frame.length, keptAt: '2026-11-08T03:00:00.000Z' }

    await writeFile(join(keepDir, '2026-11-07', 'm31_light_002.fits'), frame)
    await writeFile(join(keepDir, '2026-11-07', 'm31_light_002.fits.json'), JSON.stringify(sidecar))

    const detail = await frameDetail(keepDir, '2026-11-07', 'm31_light_002.fits')

    expect(detail).toMatchObject({ night: '2026-11-07', file: 'm31_light_002.fits', path: join(keepDir, '2026-11-07', 'm31_light_002.fits'), sha256: 'ab', run: 'r1', sequence: 'm31_light', frame: 2, bytes: frame.length })
    expect(detail?.cards.find(card => card.key === 'BAYERPAT')?.value).toBe('RGGB')
  })

  it('has nothing for a frame that was not kept or a name outside the frames folder', async () => {
    await writeFile(join(keepDir, '2026-11-07', 'loose.fits'), frame)

    expect(await frameDetail(keepDir, '2026-11-07', 'loose.fits')).toBeUndefined()
    expect(await frameDetail(keepDir, '2026-11-07', '../x.fits')).toBeUndefined()
    expect(await frameDetail(keepDir, 'tonight', 'loose.fits')).toBeUndefined()
  })

  it('refuses a kept file with no END card', async () => {
    await keepFrame('broken.fits', '2026-11-08T03:00:00.000Z', Buffer.from('SIMPLE  =                    T'.padEnd(2880 * 2, ' ')))

    await expect(frameDetail(keepDir, '2026-11-07', 'broken.fits')).rejects.toThrow('no END card')
  })
})

describe('previews', () => {
  it('makes a png, saves it next to the frame, and serves the saved one afterwards', async () => {
    await keepFrame('a_001.fits', '2026-11-08T03:00:00.000Z', frame)
    const previews = makePreviews(keepDir, settings)
    const png = await previews.get('2026-11-07', 'a_001.fits')

    expect(png === undefined ? undefined : decodePng(png).width).toBe(4)
    expect(await readdir(join(keepDir, '2026-11-07'))).toContain('a_001.fits.png')

    await rm(join(keepDir, '2026-11-07', 'a_001.fits'))

    expect(await previews.get('2026-11-07', 'a_001.fits')).toEqual(png)
  })

  it('answers undefined for a frame that was not kept and for names that are not frame names', async () => {
    const previews = makePreviews(keepDir, settings)

    await writeFile(join(keepDir, '2026-11-07', 'loose.fits'), frame)

    expect(await previews.get('2026-11-07', 'loose.fits')).toBeUndefined()
    expect(await previews.get('2026-11-07', '../../etc/passwd')).toBeUndefined()
    expect(await previews.get('..', 'a_001.fits')).toBeUndefined()
  })

  it('makes one preview for two requests at once', async () => {
    await keepFrame('a_001.fits', '2026-11-08T03:00:00.000Z', frame)
    const previews = makePreviews(keepDir, settings)
    const [first, second] = await Promise.all([previews.get('2026-11-07', 'a_001.fits'), previews.get('2026-11-07', 'a_001.fits')])

    expect(first).toBe(second)
  })
})
