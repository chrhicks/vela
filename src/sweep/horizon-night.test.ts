import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SweepFrameBody, SweepId } from '../../state/entries.ts'
import { readHorizon } from '../horizon/file.ts'
import { altitudeAt } from '../horizon/horizon.ts'
import { buildHorizon } from './horizon-night.ts'

const settings = { columnDegrees: 2.5 }
const at = Date.UTC(2026, 10, 9, 4, 0, 0)
const sweepA = 'sweep-aaaa-1111'
const sweepB = 'sweep-bbbb-2222'

const columnLine = (sweep: string, column: number, azimuthDegrees: number, edgeAltitudeDegrees: number) => ({ sweep, column, azimuthDegrees, edgeAltitudeDegrees, how: 'between-frames', frames: 2 })

const frameLine = (sweep: string, column: number, index: number): SweepFrameBody => ({
  sweep: sweep as SweepId,
  column,
  azimuthDegrees: 180,
  file: `f_${index}.fits`,
  at: at + index * 10000,
  commanded: { altitudeDegrees: 20, azimuthDegrees: 180, hourAngleDegrees: 0, declinationDegrees: 0 },
  solve: { solved: false, reason: 'no stars' },
  stars: 0,
  class: 'blocked',
  pointing: { source: 'commanded', altitudeDegrees: 20, azimuthDegrees: 180 },
})

const edgeLine = (sweep: string, bin: number, edgeAltitudeDegrees: number) => ({ sweep, bin, azimuthDegrees: bin + 0.5, cells: 9, misfits: 0, how: 'edge', edgeAltitudeDegrees, blockedAltitudeDegrees: edgeAltitudeDegrees - 0.2, skyAltitudeDegrees: edgeAltitudeDegrees + 0.2 })

const jsonl = (lines: ReadonlyArray<unknown>) => lines.map(line => `${JSON.stringify(line)}\n`).join('')

let folder = ''
let records = ''
let out = ''

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'horizon-night-test-'))
  records = join(folder, 'records')
  out = join(folder, 'vela', 'horizon.json')
  await mkdir(records)
})

afterEach(() => rm(folder, { recursive: true, force: true }))

const options = (sweepPrefix: string, now = at + 3600000) => ({ recordsFolder: records, out, sweepPrefix, settings, now: () => now })

const writeRecords = async (edges: ReadonlyArray<unknown> | undefined) => {
  await writeFile(join(records, 'columns.jsonl'), jsonl([columnLine(sweepA, 0, 101.25, 12), columnLine(sweepA, 1, 103.75, 14), columnLine(sweepB, 0, 201.25, 30)]))
  await writeFile(join(records, 'frames.jsonl'), jsonl([frameLine(sweepA, 0, 0), frameLine(sweepA, 0, 1), frameLine(sweepA, 1, 2), frameLine(sweepB, 0, 3)]))
  if (edges !== undefined) await writeFile(join(records, 'edges.jsonl'), jsonl(edges))
}

describe('building the horizon file of a sweep', () => {
  it('writes a file the reader loads, from the cells and the columns, with the time of the last frame of the column', async () => {
    await writeRecords([edgeLine(sweepA, 100, 10.5), edgeLine(sweepA, 102, 14.5), edgeLine(sweepB, 200, 29)])

    const result = await Effect.runPromise(buildHorizon(options('sweep-aaaa')))
    const horizon = await Effect.runPromise(readHorizon(out))

    expect(result).toEqual({ sweep: sweepA, fromCells: 2, fromColumns: 3, unknown: 355, kept: 0, backup: undefined })
    expect(altitudeAt(horizon, 100.5)).toBeCloseTo(11.25, 10)
    expect(horizon.altitudesDegrees.slice(100, 106)).toEqual([10.5, 12, 14.5, 14, 14, null])
    expect(horizon.observedAt[100]).toBe(new Date(at + 10000).toISOString())
    expect(horizon.observedAt[104]).toBe(new Date(at + 20000).toISOString())
    expect(horizon.sources[100]).toBe('sweep')
  })

  it('uses the columns alone when the sweep has no edges file', async () => {
    await writeRecords(undefined)

    expect(await Effect.runPromise(buildHorizon(options('sweep-aaaa')))).toMatchObject({ fromCells: 0, fromColumns: 5, unknown: 355 })
  })

  it('keeps the bins it does not give, and a copy of the file before beside it', async () => {
    await writeRecords([])
    await Effect.runPromise(buildHorizon(options('sweep-aaaa')))
    await writeFile(join(records, 'columns.jsonl'), jsonl([columnLine(sweepB, 0, 201.25, 30)]))
    const before = await readFile(out, 'utf8')

    const result = await Effect.runPromise(buildHorizon(options('sweep-bbbb', at + 7200000)))
    const horizon = await Effect.runPromise(readHorizon(out))
    const backups = (await readdir(join(folder, 'vela'))).filter(name => name.startsWith('horizon.json.bak-'))

    expect(result).toMatchObject({ fromColumns: 3, kept: 5, backup: `${out}.bak-2026-11-09T06-00-00-000Z` })
    expect(backups).toEqual(['horizon.json.bak-2026-11-09T06-00-00-000Z'])
    expect(await readFile(`${out}.bak-2026-11-09T06-00-00-000Z`, 'utf8')).toBe(before)
    expect(horizon.altitudesDegrees[101]).toBe(12)
    expect(horizon.altitudesDegrees[200]).toBe(30)
  })

  it('says which sweeps match when the prefix is not one sweep, and writes nothing', async () => {
    await writeRecords([])

    expect(await Effect.runPromise(Effect.flip(buildHorizon(options(''))))).toMatchObject({ _tag: 'SweepNotOne', found: [sweepA, sweepB] })
    expect(await Effect.runPromise(Effect.flip(buildHorizon(options('sweep-zzzz'))))).toMatchObject({ _tag: 'SweepNotOne', found: [] })
    expect(await readdir(folder)).toEqual(['records'])
  })

  it('leaves a file it cannot read as it is', async () => {
    await writeRecords([])
    await mkdir(join(folder, 'vela'))
    await writeFile(out, 'not json')

    expect(await Effect.runPromise(Effect.flip(buildHorizon(options('sweep-aaaa'))))).toMatchObject({ _tag: 'HorizonUnreadable' })
    expect(await readFile(out, 'utf8')).toBe('not json')
    expect(await readdir(join(folder, 'vela'))).toEqual(['horizon.json'])
  })

  it('fails with the line that does not decode, and with columns that are not there', async () => {
    await writeRecords([])
    await writeFile(join(records, 'edges.jsonl'), '{"sweep":"sweep-aaaa-1111"}\n')

    expect(await Effect.runPromise(Effect.flip(buildHorizon(options('sweep-aaaa'))))).toMatchObject({ _tag: 'HorizonRecordsUnreadable', path: join(records, 'edges.jsonl') })

    await rm(join(records, 'columns.jsonl'))

    expect(await Effect.runPromise(Effect.flip(buildHorizon(options('sweep-aaaa'))))).toMatchObject({ _tag: 'HorizonRecordsUnreadable', path: join(records, 'columns.jsonl') })
  })
})
