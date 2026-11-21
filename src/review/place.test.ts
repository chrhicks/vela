import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { syntheticFits } from '../testing/fits.ts'
import { placeFrame } from './place.ts'

const headers = {
  'DATE-OBS': '2026-11-18T05:00:00.000',
  EXPTIME: 120,
  SITELAT: 33.45,
  SITELONG: 247.93,
  SITEELEV: 331,
  RA: 12.5,
  DEC: 41.25,
  FOCALLEN: 400,
  XPIXSZ: 3.76,
  YPIXSZ: 3.76,
}

let keepDir = ''

const keep = async (file: string, extra: Readonly<Record<string, string | number>>, stats?: unknown) => {
  await mkdir(join(keepDir, '2026-11-17'), { recursive: true })
  await writeFile(join(keepDir, '2026-11-17', file), syntheticFits({ width: 64, height: 48, pixel: () => 1000, extra }))
  if (stats !== undefined) await writeFile(join(keepDir, '2026-11-17', `${file}.stats.json`), JSON.stringify(stats))
}

beforeEach(async () => {
  keepDir = await mkdtemp(join(tmpdir(), 'vela-place-'))
})

afterEach(() => rm(keepDir, { recursive: true, force: true }))

describe('placing a kept frame', () => {
  it('reads the exposure\'s middle, the site, the mount\'s position and the frame\'s size from the header', async () => {
    await keep('a.fits', headers)

    const view = await placeFrame(keepDir, '2026-11-17', 'a.fits')

    expect(view).toMatchObject({ at: Date.UTC(2026, 10, 18, 5, 1, 0), site: { latitudeDegrees: 33.45, longitudeDegrees: 247.93 - 360, elevationMeters: 331 }, columns: 64, rows: 48, mount: { raDegrees: 12.5, decDegrees: 41.25 }, solution: null })
    expect(view?.heightDegrees).toBeCloseTo(((2 * Math.atan((48 * 3.76) / 1000 / 2 / 400)) * 180) / Math.PI, 6)
  })

  it('takes the solve from the frame\'s stats when it has one, and none when the stats hold no solve', async () => {
    const solution = { centre: { raDegrees: 12.6, decDegrees: 41.3 }, referencePixel: [32.5, 24.5], matrix: [[-0.0005, 0], [0, 0.0005]] }

    await keep('solved.fits', headers, { centre: solution.centre, solution, stars: 100 })
    await keep('unsolved.fits', headers, { centre: null, solution: null, stars: 3 })
    await keep('unmeasured.fits', headers)

    expect((await placeFrame(keepDir, '2026-11-17', 'solved.fits'))?.solution).toEqual(solution)
    expect((await placeFrame(keepDir, '2026-11-17', 'unsolved.fits'))?.solution).toBeNull()
    expect((await placeFrame(keepDir, '2026-11-17', 'unmeasured.fits'))?.solution).toBeNull()
  })

  it('places nothing when the frame is missing or its header lacks the start time, the site, the position or the scale', async () => {
    for (const lacking of ['DATE-OBS', 'SITELAT', 'SITELONG', 'RA', 'FOCALLEN']) {
      const { [lacking as keyof typeof headers]: _, ...rest } = headers

      await keep(`no-${lacking}.fits`, rest)
      expect(await placeFrame(keepDir, '2026-11-17', `no-${lacking}.fits`)).toBeUndefined()
    }

    expect(await placeFrame(keepDir, '2026-11-17', 'absent.fits')).toBeUndefined()
  })
})
