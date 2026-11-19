import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Result } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PlateSolution } from '../frames/stats.ts'
import { syntheticFits } from '../testing/fits.ts'
import { decodePng } from '../testing/png.ts'
import { makeStacks } from './stacks.ts'

const solution: PlateSolution = {
  centre: { raDegrees: 23.46, decDegrees: 30.65 },
  referencePixel: [40.5, 24.5],
  matrix: [
    [-1 / 3600, 0],
    [0, 1 / 3600],
  ],
}

const preview = { bin: 2, blackSigmas: 2.8, targetMedian: 0.25 }
const night = '2026-11-15'
let keepDir = ''
const solved: string[] = []
const failures: string[] = []

const light = (imageType = 'Light Frame') => syntheticFits({ width: 80, height: 48, pattern: 'RGGB', pixel: (x, y) => 500 + ((x * 7 + y * 13) % 50), extra: { IMAGETYP: imageType, RA: 23.46, DEC: 30.65 } })

const rowOf = ({ width, rgb }: { readonly width: number; readonly rgb: Uint8Array }, row: number) => [...rgb.subarray(row * width * 3, (row + 1) * width * 3)]

const stacks = () =>
  makeStacks({
    keepDir,
    preview,
    solve: async path => {
      solved.push(path)
      return 'PLTSOLVD=T\nCRVAL1=23.46\nCRVAL2=30.65\nCRPIX1=40.5\nCRPIX2=24.5\nCD1_1=-0.000277777\nCD1_2=0\nCD2_1=0\nCD2_2=0.000277777\n'
    },
    failed: file => void failures.push(file),
  })

beforeEach(async () => {
  keepDir = await mkdtemp(join(tmpdir(), 'vela-stacks-'))
  solved.length = 0
  failures.length = 0
  await mkdir(join(keepDir, night))
  await mkdir(join(keepDir, '2026-11-16'))

  for (const [file, bytes] of [['M-33_light_001.fits', light()], ['M-33_light_002.fits', light()], ['test-frame_light_001.fits', light()], ['M-33_dark_001.fits', light('Dark Frame')]] as const) {
    await writeFile(join(keepDir, night, file), bytes)
  }

  await writeFile(join(keepDir, '2026-11-16', 'M-33_light_001.fits'), light())
})

afterEach(() => rm(keepDir, { recursive: true, force: true }))

describe('the night stacks', () => {
  it('stacks each target of the night once a frame, and leaves out test frames and darks', async () => {
    const kept = stacks()

    expect(await kept.add({ night, file: 'M-33_light_001.fits', sequence: 'M-33_light' }, solution)).toEqual({ night, sequence: 'M-33_light', frames: 1, leftOut: 0 })
    expect(await kept.add({ night, file: 'M-33_light_002.fits', sequence: 'M-33_light' }, solution)).toEqual({ night, sequence: 'M-33_light', frames: 2, leftOut: 0 })
    expect(await kept.add({ night, file: 'M-33_light_002.fits', sequence: 'M-33_light' }, solution)).toBeUndefined()
    expect(await kept.add({ night, file: 'test-frame_light_001.fits', sequence: 'test-frame_light' }, solution)).toBeUndefined()
    expect(await kept.add({ night, file: 'M-33_dark_001.fits', sequence: 'M-33_dark' }, solution)).toBeUndefined()
    expect(kept.picture(night, 'M-33_light')?.png.subarray(1, 4).toString()).toBe('PNG')
    expect(kept.picture(night, 'M-33_light')?.frames).toBe(2)
    expect(kept.picture(night, 'NGC-7635_light')).toBeUndefined()
  })

  it('gives the stack in its own pixels and a box of it at full size, with the frames it holds', async () => {
    const kept = stacks()

    await kept.add({ night, file: 'M-33_light_001.fits', sequence: 'M-33_light' }, solution)

    const shape = kept.shape(night, 'M-33_light')
    const whole = kept.picture(night, 'M-33_light')
    const box = kept.crop(night, 'M-33_light', { x: 2, y: 1, width: 10, height: 6 })

    expect(shape).toEqual({ width: 20, height: 12 })
    expect(whole === undefined ? undefined : decodePng(whole.png)).toMatchObject({ width: 20, height: 12 })
    expect(box !== undefined && Result.isSuccess(box) ? [decodePng(box.success.png), box.success.frames] : undefined).toMatchObject([{ width: 10, height: 6 }, 1])
    expect(box !== undefined && Result.isSuccess(box) && whole !== undefined ? rowOf(decodePng(box.success.png), 0) : undefined).toEqual(whole === undefined ? undefined : rowOf(decodePng(whole.png), 1).slice(2 * 3, 12 * 3))
    expect(kept.crop(night, 'M-33_light', { x: 15, y: 0, width: 10, height: 6 })).toMatchObject({ _tag: 'Failure' })
    expect(kept.crop(night, 'NGC-7635_light', { x: 0, y: 0, width: 10, height: 6 })).toBeUndefined()
    expect(kept.shape('2026-11-16', 'M-33_light')).toBeUndefined()
  })

  it('solves a frame that has no stats yet, and counts one that does not solve as left out', async () => {
    const kept = makeStacks({ keepDir, preview, solve: async () => 'PLTSOLVD=F', failed: () => undefined })

    expect(await kept.add({ night, file: 'M-33_light_001.fits', sequence: 'M-33_light' }, undefined)).toEqual({ night, sequence: 'M-33_light', frames: 0, leftOut: 1 })
    expect(await stacks().add({ night, file: 'M-33_light_001.fits', sequence: 'M-33_light' }, undefined)).toEqual({ night, sequence: 'M-33_light', frames: 1, leftOut: 0 })
    expect(solved).toEqual([join(keepDir, night, 'M-33_light_001.fits')])
  })

  it('starts over on a new night', async () => {
    const kept = stacks()

    await kept.add({ night, file: 'M-33_light_001.fits', sequence: 'M-33_light' }, solution)

    expect(await kept.add({ night: '2026-11-16', file: 'M-33_light_001.fits', sequence: 'M-33_light' }, solution)).toEqual({ night: '2026-11-16', sequence: 'M-33_light', frames: 1, leftOut: 0 })
    expect(kept.picture(night, 'M-33_light')).toBeUndefined()
  })

  it('does not solve again a frame already known not to solve', async () => {
    const kept = stacks()
    await writeFile(join(keepDir, night, 'M-33_light_002.fits.stats.json'), JSON.stringify({ solution: null }))

    expect(await kept.add({ night, file: 'M-33_light_001.fits', sequence: 'M-33_light' }, null)).toEqual({ night, sequence: 'M-33_light', frames: 0, leftOut: 1 })
    expect(await kept.add({ night, file: 'M-33_light_002.fits', sequence: 'M-33_light' }, undefined)).toEqual({ night, sequence: 'M-33_light', frames: 0, leftOut: 2 })
    expect(solved).toEqual([])
  })

  it('reports a frame it cannot read and counts it as left out', async () => {
    const kept = stacks()
    await writeFile(join(keepDir, night, 'M-33_light_003.fits'), 'not a picture')

    expect(await kept.add({ night, file: 'M-33_light_003.fits', sequence: 'M-33_light' }, undefined)).toEqual({ night, sequence: 'M-33_light', frames: 0, leftOut: 1 })
    expect(await kept.add({ night, file: 'M-33_light_001.fits', sequence: 'M-33_light' }, solution)).toEqual({ night, sequence: 'M-33_light', frames: 1, leftOut: 1 })
    expect(failures).toEqual(['M-33_light_003.fits'])
  })
})
