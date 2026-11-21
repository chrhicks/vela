import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SweepFrameBody, SweepId } from '../../state/entries.ts'
import { decodeConfig } from '../config.ts'
import { syntheticFits } from '../testing/fits.ts'
import { extractStars, labelNight, measureWithAstap, readFrameRecords, siteOf, type MeasureFile } from './cell-night.ts'
import { SweepSettings } from './settings.ts'

const phoenix = { latitudeDegrees: 33.45, longitudeDegrees: -112.07, elevationMeters: 331 }
const settings = decodeConfig(SweepSettings, { cells: { columns: 8, rows: 6 } })
const size = { width: 800, height: 600 }
const at = Date.UTC(2026, 10, 9, 4, 0, 0)

const record = (sweep: string, file: string, index: number): SweepFrameBody => ({
  sweep: sweep as SweepId,
  column: 0,
  azimuthDegrees: 180,
  file,
  at: at + index * 10000,
  commanded: { altitudeDegrees: 20, azimuthDegrees: 180, hourAngleDegrees: 0, declinationDegrees: 0 },
  TELESCOPE_PIER_SIDE: 'PIER_WEST',
  solve: { solved: true, raDegrees: 10, decDegrees: 20, rotationDegrees: 0, scaleArcsecPerPixel: 2 },
  stars: 10,
  class: 'sky',
  pointing: { source: 'solve', altitudeDegrees: 20, azimuthDegrees: 180 },
})

const stub: MeasureFile = async () => ({ size, counts: Array.from({ length: 48 }, () => 10), levels: Array.from({ length: 48 }, () => 500), headerScale: 2, site: phoenix })

let folder = ''

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'cell-night-test-'))
  await mkdir(join(folder, 'records'))
  await mkdir(join(folder, 'frames'))
})

afterEach(() => rm(folder, { recursive: true, force: true }))

const writeRecords = (records: ReadonlyArray<SweepFrameBody>) => writeFile(join(folder, 'records', 'frames.jsonl'), records.map(line => `${JSON.stringify(line)}\n`).join(''))

const options = (measure: MeasureFile, sweepPrefix = '') => ({ recordsFolder: join(folder, 'records'), framesFolder: join(folder, 'frames'), outFolder: join(folder, 'out'), sweepPrefix, settings, measure, now: () => 0 })

const lines = async (name: string) =>
  (await readFile(join(folder, 'out', name), 'utf8'))
    .split('\n')
    .filter(line => line !== '')
    .map(line => JSON.parse(line) as Record<string, unknown>)

describe('the records of a night', () => {
  it('are one frame record a line, decoded with the schema', async () => {
    await writeRecords([record('sweep-a', 'a_1.fits', 0), record('sweep-a', 'a_2.fits', 1)])

    expect((await Effect.runPromise(readFrameRecords(join(folder, 'records', 'frames.jsonl')))).map(frame => frame.file)).toEqual(['a_1.fits', 'a_2.fits'])
  })

  it('fail with the line that does not decode, and with a file that is not there', async () => {
    await writeFile(join(folder, 'records', 'frames.jsonl'), `${JSON.stringify(record('sweep-a', 'a_1.fits', 0))}\n{"file":1}\n`)

    expect(await Effect.runPromise(readFrameRecords(join(folder, 'records', 'frames.jsonl')).pipe(Effect.flip))).toMatchObject({ _tag: 'CellRecordsUnreadable', reason: expect.stringContaining('line 2') })
    expect(await Effect.runPromise(readFrameRecords(join(folder, 'nowhere.jsonl')).pipe(Effect.flip))).toMatchObject({ _tag: 'CellRecordsUnreadable' })
  })
})

describe('labelling a night', () => {
  it('writes cells.jsonl with a line for each frame and edges.jsonl with a line for each bin, each sweep apart', async () => {
    await writeRecords([record('sweep-a', 'a_1.fits', 0), record('sweep-a', 'a_2.fits', 1), record('sweep-b', 'b_1.fits', 2)])

    const result = await Effect.runPromise(labelNight(options(stub)))
    const cells = await lines('cells.jsonl')
    const edges = await lines('edges.jsonl')

    expect(result).toMatchObject({ frames: 3, failures: [] })
    expect(cells.map(line => line['file'])).toEqual(['a_1.fits', 'a_2.fits', 'b_1.fits'])
    expect((cells[0]!['cells'] as ReadonlyArray<unknown>).length).toBe(48)
    expect(edges.length).toBe(result.edges)
    expect(new Set(edges.map(edge => edge['sweep']))).toEqual(new Set(['sweep-a', 'sweep-b']))
    expect(edges.every(edge => edge['how'] === 'open')).toBe(true)
  })

  it('takes only the sweeps whose id starts with the prefix', async () => {
    await writeRecords([record('sweep-a1', 'a_1.fits', 0), record('sweep-b2', 'b_1.fits', 1)])

    await Effect.runPromise(labelNight(options(stub, 'sweep-b')))

    expect((await lines('cells.jsonl')).map(line => line['file'])).toEqual(['b_1.fits'])
  })

  it('reads each frame from the frames folder and leaves a frame it cannot measure out, naming it', async () => {
    await writeRecords([record('sweep-a', 'a_1.fits', 0), record('sweep-a', 'a_2.fits', 1)])

    const measure: MeasureFile = async path => {
      if (path.endsWith('a_2.fits')) throw new Error('ASTAP did not run')

      expect(path).toBe(join(folder, 'frames', 'a_1.fits'))

      return stub(path)
    }
    const result = await Effect.runPromise(labelNight(options(measure)))

    expect(result.failures).toEqual([{ file: 'a_2.fits', reason: 'ASTAP did not run' }])
    expect((await lines('cells.jsonl')).map(line => line['file'])).toEqual(['a_1.fits'])
  })

  it('leaves out and names the frames of a sweep none of whose frames carries the site', async () => {
    await writeRecords([record('sweep-a', 'a_1.fits', 0), record('sweep-b', 'b_1.fits', 0)])
    const siteless: MeasureFile = async path => ({ ...(await stub(path)), site: path.endsWith('a_1.fits') ? undefined : phoenix })

    const result = await Effect.runPromise(labelNight(options(siteless)))

    expect(result).toMatchObject({ frames: 1, failures: [{ file: 'a_1.fits', reason: 'no frame of its sweep has SITELAT and SITELONG in its header' }] })
  })

  it('takes the site from the header, elevation 0 when it is not there', () => {
    expect(siteOf(new Map<string, number | string>([['SITELAT', 33.45], ['SITELONG', -112.07]]))).toEqual({ latitudeDegrees: 33.45, longitudeDegrees: -112.07, elevationMeters: 0 })
    expect(siteOf(new Map<string, number | string>([['SITELAT', 33.45], ['SITELONG', -112.07], ['SITEELEV', 331]]))).toEqual(phoenix)
    expect(siteOf(new Map<string, number | string>([['SITELAT', 33.45]]))).toBeUndefined()
    expect(siteOf(new Map<string, number | string>([['SITELAT', '33.45'], ['SITELONG', -112.07]]))).toBeUndefined()
  })

  it('fails with the folder it could not write to', async () => {
    await writeRecords([record('sweep-a', 'a_1.fits', 0)])
    await writeFile(join(folder, 'out'), 'in the way')

    expect(await Effect.runPromise(labelNight(options(stub)).pipe(Effect.flip))).toMatchObject({ _tag: 'CellOutputUnwritable' })
  })
})

describe('extracting the stars of a kept frame', () => {
  const fakeAstap = async (csv: string) => {
    const program = join(folder, 'astap')

    await writeFile(program, `#!/bin/sh\nwhile [ $# -gt 0 ]; do if [ "$1" = "-f" ]; then frame="$2"; fi; shift; done\nprintf '${csv}' > "\${frame%.fits}.csv"\n`)
    await chmod(program, 0o755)

    return program
  }

  it('lists the stars through a copy of the name in a folder of its own, so the kept frame has nothing written beside it', async () => {
    const program = await fakeAstap('x,y,hfd,snr,flux\\n10.5,20.5,3,50,900\\n700,500,4,20,300\\n')
    const kept = join(folder, 'frames', 'horizon-sweep_light_001.fits')

    await writeFile(kept, 'frame')

    const stars = await extractStars(program, kept, 10, 10000)

    expect(stars.map(star => [star.x, star.y])).toEqual([[10.5, 20.5], [700, 500]])
    expect(await readdir(join(folder, 'frames'))).toEqual(['horizon-sweep_light_001.fits'])
  })

  it('gives each cell its star count and median level from the frame itself', async () => {
    const program = await fakeAstap('x,y,hfd,snr,flux\\n10.5,20.5,3,50,900\\n12,30,4,20,300\\n790,590,4,20,300\\n')
    const kept = join(folder, 'frames', 'frame.fits')

    await writeFile(kept, syntheticFits({ width: 800, height: 600, pixel: (x, y) => (y < 300 ? 100 : 700), extra: { SCALE: 1.94 } }))

    const measured = await measureWithAstap({ program, analyseSnr: 10, listLimit: 10000 }, { columns: 8, rows: 6 })(kept)

    expect(measured.size).toEqual(size)
    expect(measured.counts[0]).toBe(2)
    expect(measured.counts[47]).toBe(1)
    expect(measured.levels[0]).toBe(100)
    expect(measured.levels[47]).toBe(700)
    expect(measured.headerScale).toBe(1.94)
  })

  it('fails when the program is not there', async () => {
    await expect(extractStars(join(folder, 'missing'), join(folder, 'frames', 'x.fits'), 10, 10000)).rejects.toThrow()
  })
})
