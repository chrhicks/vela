import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { syntheticFits } from '../testing/fits.ts'
import { decodePng } from '../testing/png.ts'
import { listNight, makePreviews } from './library.ts'

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
  it('lists the night newest first and ignores previews and partial files', async () => {
    await keepFrame('a_001.fits', '2026-11-08T03:00:00.000Z')
    await keepFrame('a_002.fits', '2026-11-08T03:05:00.000Z')
    await writeFile(join(keepDir, '2026-11-07', 'a_002.fits.png'), 'png')
    await writeFile(join(keepDir, '2026-11-07', 'a_003.fits.part'), 'half')

    expect(await listNight(keepDir, '2026-11-07')).toEqual({
      night: '2026-11-07',
      frames: [
        { file: 'a_002.fits', bytes: 1, keptAt: '2026-11-08T03:05:00.000Z' },
        { file: 'a_001.fits', bytes: 1, keptAt: '2026-11-08T03:00:00.000Z' },
      ],
    })
  })

  it('has no frames for a night with no folder', async () => {
    expect(await listNight(keepDir, '2026-11-09')).toEqual({ night: '2026-11-09', frames: [] })
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
