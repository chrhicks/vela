import { execFile } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runBench, type BenchOptions } from './bench.ts'
import type { RecordedStatistics } from './frames.ts'

const tool = join(dirname(fileURLToPath(import.meta.url)), '..')

const fixture = join(tool, 'fixture', 'saved-images')

const frame = (id: string) => join('fixture-rig', id)

let copy: string

beforeEach(async () => {
  copy = await mkdtemp(join(tmpdir(), 'star-bench-'))
  await cp(fixture, copy, { recursive: true })
})

afterEach(() => rm(copy, { recursive: true, force: true }))

const options = (savedImages: string, listFile: string | null = null): BenchOptions => ({
  savedImages,
  listFile,
  jobs: 1,
  gapMinutes: 30,
  restartTimes: [],
})

async function record(id: string, statistics: RecordedStatistics | null) {
  const path = join(copy, frame(id), 'metadata.json')
  const metadata: { statistics: RecordedStatistics | null } = JSON.parse(await readFile(path, 'utf8'))
  metadata.statistics = statistics
  await writeFile(path, JSON.stringify(metadata))
}

describe('the bench on the committed fixture', () => {
  it('measures every frame with Vela and finds all four equal to their records', async () => {
    const result = await runBench(options(fixture))

    expect(result.allMatch).toBe(true)
    expect(result.report).toContain('4 of 4 frames match the recorded statistics.')
    expect(result.report).toContain('Fixture Nebula, 90 s: 3 frames')
    expect(result.report).toContain('Frames outside any run: 1 (dark 1)')
    expect(result.report).toContain('alerts none')
  })

  it('writes one table row per frame with the measured and the recorded numbers', async () => {
    const rows = (await runBench(options(fixture))).table.trimEnd().split('\n').map(row => row.split('\t'))
    const [header, ...frames] = rows

    expect(frames).toHaveLength(4)
    const stars = header!.indexOf('detected_stars')
    expect(frames.map(row => row[stars])).toEqual(['26', '26', '6', '0'])
    expect(frames.map(row => row[header!.indexOf('recorded_detected_stars')])).toEqual(['26', '26', '6', '0'])
    expect(frames.map(row => row[header!.indexOf('comparison')])).toEqual(['match', 'match', 'match', 'match'])
    expect(frames.map(row => row[header!.indexOf('frame_type')])).toEqual(['light', 'light', 'light', 'dark'])
  })

  it('fills the named outputs for every frame and accounts for every peak', async () => {
    const result = await runBench(options(fixture))
    const [header, ...frames] = result.table.trimEnd().split('\n').map(row => row.split('\t'))
    const column = (name: string) => header!.indexOf(name)
    const number = (row: string[], name: string) => Number(row[column(name)])
    const reasons = header!.filter(name => name.startsWith('rejected_'))

    expect(reasons).toHaveLength(8)

    for (const row of frames) {
      for (const name of ['detections', 'measured', 'strong', 'sky_level', 'sky_noise', ...reasons])
        expect(row[column(name)], name).toMatch(/^-?\d+(\.\d+)?$/)

      expect(number(row, 'measured')).toBe(number(row, 'detected_stars'))
      expect(number(row, 'strong')).toBeLessThanOrEqual(number(row, 'measured'))
      const rejected = reasons.reduce((sum, name) => sum + number(row, name), 0)

      expect(number(row, 'detections')).toBe(number(row, 'measured') + rejected)
    }

    expect(result.report).toMatch(/per frame, median: peaks \d+, measured 26, strong \d+, sky \d+/)
    expect(result.report).toMatch(/rejected by first failed gate, median: blended \d+, edge \d+, unconverged \d+, faint \d+/)
  })

  it('reports a record that no longer equals the measurement, and does not pass', async () => {
    await record('fixture-light-2', { detectedStars: 99, medianHfrPixels: 2.7495413665640918 })

    const result = await runBench(options(copy))

    expect(result.allMatch).toBe(false)
    expect(result.report).toContain('3 of 4 frames match')
    expect(result.report).toContain('differ fixture-light-2: stars 26 vs recorded 99')
  })

  it('does not count a frame with no record as a match', async () => {
    await record('fixture-light-2', null)

    const result = await runBench(options(copy))

    expect(result.allMatch).toBe(false)
    expect(result.report).toContain('unrecorded 1')
  })

  it('does not count a frame it cannot measure as a match', async () => {
    await truncate(join(copy, frame('fixture-light-2'), 'original.fits'), 3000)

    const result = await runBench(options(copy))

    expect(result.allMatch).toBe(false)
    expect(result.report).toContain('not measured 1')
    expect(result.report).toContain('Fixture Nebula, 90 s: 2 frames')
  })

  it('reports a directory without usable metadata instead of dropping it silently', async () => {
    await writeFile(join(copy, frame('fixture-light-2'), 'metadata.json'), '{ not json')

    const result = await runBench(options(copy))

    expect(result.report).toContain('3 of 3 frames match')
    expect(result.report).toContain('1 directories skipped, first: no readable metadata.json')
  })

  it('measures only the listed frames, and refuses a list that names a frame it lacks', async () => {
    const list = join(copy, 'list.txt')
    await writeFile(list, `${join(copy, frame('fixture-light-1'), 'original.fits')}\tpeaks/one.json\n`)
    expect((await runBench(options(copy, list))).report).toContain('1 of 1 frames match')

    await writeFile(list, `${join(copy, frame('fixture-light-1'))}\n${join(copy, frame('gone'))}\n`)
    await expect(runBench(options(copy, list))).rejects.toThrow('1 listed frames are not in the saved images')
  })

  it('gives the same report from the command line on worker threads', async () => {
    const run = promisify(execFile)
    const table = join(copy, 'frames.tsv')

    const { stdout } = await run(
      process.execPath,
      ['--import', 'tsx', 'src/cli.ts', fixture, '--jobs', '2', '--table', table],
      { cwd: tool },
    )

    expect(stdout).toBe((await runBench(options(fixture))).report)
    expect(await readFile(table, 'utf8')).toBe((await runBench(options(fixture))).table)
  })
})
