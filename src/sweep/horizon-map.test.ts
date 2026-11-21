import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect, Schema } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NightName, SweepId } from '../../state/entries.ts'
import { HorizonSweep } from '../../state/horizon-sweep.ts'
import { noHorizon, type Horizon } from '../horizon/horizon.ts'
import { readHorizonSweep } from './horizon-map.ts'

const sweepA = SweepId.make('sweep-aaaa-1111')
const sweepB = SweepId.make('sweep-bbbb-2222')
const sweepC = SweepId.make('sweep-cccc-3333')
const nightOne = NightName.make('2026-11-08')
const nightTwo = NightName.make('2026-11-09')

const frameLine = (sweep: string, altitudeDegrees: number, azimuthDegrees: number, kind: 'sky' | 'blocked' | 'edge' = 'sky', source: 'solve' | 'commanded+offset' | 'commanded' = 'solve') => ({
  sweep,
  column: 0,
  azimuthDegrees,
  file: 'f.fits',
  at: 1,
  commanded: { altitudeDegrees: 0, azimuthDegrees: 0, hourAngleDegrees: 0, declinationDegrees: 0 },
  solve: { solved: false, reason: 'no stars' },
  stars: 0,
  class: kind,
  pointing: { source, altitudeDegrees, azimuthDegrees },
})

const edgeLine = (sweep: string, bin: number, how: 'edge' | 'open' | 'blocked') => ({ sweep, bin, azimuthDegrees: bin + 0.5, cells: 9, misfits: 0, how })

const jsonl = (lines: ReadonlyArray<unknown>) => lines.map(line => `${JSON.stringify(line)}\n`).join('')

const horizonWith = (origins: ReadonlyArray<readonly [number, { readonly sweep: SweepId; readonly night: NightName }]>): Horizon => {
  const given = new Map(origins)

  return { ...noHorizon, origins: Array.from({ length: 360 }, (_, bin) => given.get(bin) ?? null) }
}

let folder = ''

const night = async (name: string, files: { readonly frames?: string; readonly edges?: string }) => {
  await mkdir(join(folder, name), { recursive: true })
  if (files.frames !== undefined) await writeFile(join(folder, name, 'frames.jsonl'), files.frames)
  if (files.edges !== undefined) await writeFile(join(folder, name, 'edges.jsonl'), files.edges)
}

const read = (horizon: Horizon) => Effect.runPromise(readHorizonSweep(folder, horizon))

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'horizon-map-test-'))
})

afterEach(() => rm(folder, { recursive: true, force: true }))

describe('the horizon sweep records behind the tree line', () => {
  it('keeps only the sweep the horizon names from a directory three sweeps share, and only the fields the map draws', async () => {
    await night('2026-11-08', {
      frames: jsonl([frameLine(sweepA, 20, 100), frameLine(sweepB, 10, 200, 'blocked', 'commanded+offset'), frameLine(sweepC, 5, 300), frameLine(sweepB, 12, 210, 'sky', 'commanded')]),
      edges: jsonl([edgeLine(sweepA, 100, 'edge'), edgeLine(sweepB, 101, 'blocked'), edgeLine(sweepB, 102, 'open'), edgeLine(sweepB, 103, 'edge'), edgeLine(sweepC, 104, 'edge')]),
    })

    const answer = await read(horizonWith([[101, { sweep: sweepB, night: nightOne }], [102, { sweep: sweepB, night: nightOne }], [104, { sweep: sweepB, night: nightOne }]]))

    expect(answer.status).toBe('available')
    if (answer.status !== 'available') return
    expect(answer.nights).toEqual(['2026-11-08'])
    expect(answer.frames).toEqual([
      { altitudeDegrees: 10, azimuthDegrees: 200, source: 'commanded+offset', class: 'blocked' },
      { altitudeDegrees: 12, azimuthDegrees: 210, source: 'commanded', class: 'sky' },
    ])
    expect(Object.keys(answer.frames[0]!)).toEqual(['altitudeDegrees', 'azimuthDegrees', 'source', 'class'])
    expect(answer.edges).toHaveLength(360)
    expect(answer.edges.flatMap((kind, bin) => (kind === null ? [] : [[bin, kind]]))).toEqual([[101, 'blocked'], [102, 'open']])
    expect(Schema.decodeUnknownSync(HorizonSweep)(JSON.parse(JSON.stringify(answer)))).toEqual(answer)
  })

  it('reads the sweeps of two nights, each bin with the edges of its own sweep', async () => {
    await night('2026-11-08', { frames: jsonl([frameLine(sweepA, 20, 100)]), edges: jsonl([edgeLine(sweepA, 10, 'edge'), edgeLine(sweepA, 11, 'blocked')]) })
    await night('2026-11-09', { frames: jsonl([frameLine(sweepB, 30, 250, 'blocked', 'commanded')]), edges: jsonl([edgeLine(sweepB, 11, 'open'), edgeLine(sweepB, 250, 'edge')]) })

    const answer = await read(horizonWith([[10, { sweep: sweepA, night: nightOne }], [11, { sweep: sweepB, night: nightTwo }], [250, { sweep: sweepB, night: nightTwo }]]))

    expect(answer.status).toBe('available')
    if (answer.status !== 'available') return
    expect(answer.nights).toEqual(['2026-11-08', '2026-11-09'])
    expect(answer.frames.map(frame => frame.altitudeDegrees)).toEqual([20, 30])
    expect(answer.edges[10]).toBe('edge')
    expect(answer.edges[11]).toBe('open')
    expect(answer.edges[250]).toBe('edge')
  })

  it('gives no edge kind to a bin with null origins, and none to a bin its sweep has no edge row for', async () => {
    await night('2026-11-08', { frames: jsonl([frameLine(sweepA, 20, 100)]), edges: jsonl([edgeLine(sweepA, 10, 'edge')]) })

    const answer = await read(horizonWith([[10, { sweep: sweepA, night: nightOne }], [11, { sweep: sweepA, night: nightOne }]]))

    expect(answer.status === 'available' && answer.edges.slice(8, 13)).toEqual([null, null, 'edge', null, null])
  })

  it('says the map is unavailable when no bin names a sweep', async () => {
    expect(await read(noHorizon)).toEqual({ status: 'unavailable', reason: 'no-origins', night: null, file: null })
  })

  it('says which file is missing', async () => {
    await night('2026-11-08', { frames: jsonl([frameLine(sweepA, 20, 100)]) })

    expect(await read(horizonWith([[10, { sweep: sweepA, night: nightOne }]]))).toEqual({ status: 'unavailable', reason: 'missing', night: '2026-11-08', file: 'edges.jsonl' })
    expect(await read(horizonWith([[10, { sweep: sweepA, night: nightTwo }]]))).toEqual({ status: 'unavailable', reason: 'missing', night: '2026-11-09', file: 'frames.jsonl' })
  })

  it('says so when the records hold nothing of the sweep the horizon names', async () => {
    await night('2026-11-08', { frames: jsonl([frameLine(sweepB, 20, 100)]), edges: jsonl([edgeLine(sweepA, 10, 'edge')]) })

    expect(await read(horizonWith([[10, { sweep: sweepA, night: nightOne }]]))).toEqual({ status: 'unavailable', reason: 'no-frames', night: '2026-11-08', file: 'frames.jsonl' })

    await night('2026-11-09', { frames: jsonl([frameLine(sweepA, 20, 100)]), edges: jsonl([edgeLine(sweepB, 10, 'edge')]) })

    expect(await read(horizonWith([[10, { sweep: sweepA, night: nightTwo }]]))).toEqual({ status: 'unavailable', reason: 'no-edges', night: '2026-11-09', file: 'edges.jsonl' })
  })

  it('says a file is unreadable when a line of the sweep does not decode or is not JSON, and not for another sweep', async () => {
    const edges = jsonl([edgeLine(sweepA, 10, 'edge')])
    const origins = horizonWith([[10, { sweep: sweepA, night: nightOne }]])

    await night('2026-11-08', { frames: `${jsonl([frameLine(sweepA, 20, 100)])}{"sweep":"sweep-aaaa-1111","class":"sky"\n`, edges })
    expect(await read(origins)).toEqual({ status: 'unavailable', reason: 'unreadable', night: '2026-11-08', file: 'frames.jsonl' })

    await night('2026-11-08', { frames: `${jsonl([frameLine(sweepA, 20, 100)])}${JSON.stringify({ sweep: sweepA, class: 'sky', pointing: { source: 'guess', altitudeDegrees: 1, azimuthDegrees: 2 } })}\n`, edges })
    expect(await read(origins)).toMatchObject({ status: 'unavailable', reason: 'unreadable', file: 'frames.jsonl' })

    await night('2026-11-08', { frames: jsonl([frameLine(sweepA, 20, 100)]), edges: `${edges}${JSON.stringify({ sweep: sweepA, bin: 360, how: 'edge' })}\n` })
    expect(await read(origins)).toMatchObject({ status: 'unavailable', reason: 'unreadable', file: 'edges.jsonl' })

    await night('2026-11-08', { frames: `${jsonl([frameLine(sweepA, 20, 100)])}${JSON.stringify({ sweep: sweepB, class: 'unheard-of' })}\n`, edges })
    expect((await read(origins)).status).toBe('available')

    await night('2026-11-08', { frames: `${jsonl([frameLine(sweepA, 20, 100)])}\n\n`, edges })
    expect((await read(origins)).status).toBe('available')
  })

  it('reads a night once for the several sweeps it holds and keeps each sweep apart', async () => {
    await night('2026-11-08', { frames: jsonl([frameLine(sweepA, 1, 1), frameLine(sweepB, 2, 2), frameLine(sweepA, 3, 3)]), edges: jsonl([edgeLine(sweepA, 5, 'edge'), edgeLine(sweepB, 5, 'blocked'), edgeLine(sweepB, 6, 'open')]) })

    const answer = await read(horizonWith([[5, { sweep: sweepA, night: nightOne }], [6, { sweep: sweepB, night: nightOne }]]))

    expect(answer.status === 'available' && answer.frames.map(frame => frame.altitudeDegrees)).toEqual([1, 3, 2])
    expect(answer.status === 'available' && [answer.edges[5], answer.edges[6]]).toEqual(['edge', 'open'])
  })
})
