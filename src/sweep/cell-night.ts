import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Data, Effect, Schema } from 'effect'
import { SweepFrameFields, type SweepFrameBody, type SweepId } from '../../state/entries.ts'
import { readFits, type HeaderValue } from '../frames/fits.ts'
import { arcsecPerPixel, readStarList, type StarSettings } from '../frames/stats.ts'
import type { Site } from '../pointing/target.ts'
import { cellLevels, countStars, type FrameSize } from './cells.ts'
import { labelSweep, type MeasuredFrame } from './labelling.ts'
import type { SweepSettings } from './settings.ts'

const run = promisify(execFile)

export class CellRecordsUnreadable extends Data.TaggedError('CellRecordsUnreadable')<{ readonly path: string; readonly reason: string }> {}

export class CellOutputUnwritable extends Data.TaggedError('CellOutputUnwritable')<{ readonly path: string; readonly reason: string }> {}

export interface FileMeasure {
  readonly size: FrameSize
  readonly counts: ReadonlyArray<number>
  readonly levels: ReadonlyArray<number>
  readonly headerScale: number | undefined
  readonly site: Site | undefined
}

export type MeasureFile = (path: string) => Promise<FileMeasure>

export interface FrameFailure {
  readonly file: string
  readonly reason: string
}

export interface NightResult {
  readonly frames: number
  readonly edges: number
  readonly failures: ReadonlyArray<FrameFailure>
  readonly seconds: number
}

const numberIn = (header: ReadonlyMap<string, HeaderValue>, key: string) => {
  const value = header.get(key)
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function siteOf(header: ReadonlyMap<string, HeaderValue>): Site | undefined {
  const latitudeDegrees = numberIn(header, 'SITELAT')
  const longitudeDegrees = numberIn(header, 'SITELONG')

  return latitudeDegrees === undefined || longitudeDegrees === undefined ? undefined : { latitudeDegrees, longitudeDegrees, elevationMeters: numberIn(header, 'SITEELEV') ?? 0 }
}

const reasonOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

const decodeLine = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct(SweepFrameFields)))

export const readFrameRecords = (path: string): Effect.Effect<ReadonlyArray<SweepFrameBody>, CellRecordsUnreadable> =>
  Effect.tryPromise({ try: () => readFile(path, 'utf8'), catch: cause => new CellRecordsUnreadable({ path, reason: reasonOf(cause) }) }).pipe(
    Effect.flatMap(text =>
      Effect.forEach(
        text.split('\n').filter(line => line.trim() !== ''),
        (line, index) => decodeLine(line).pipe(Effect.mapError(error => new CellRecordsUnreadable({ path, reason: `line ${index + 1}: ${error.message}` }))),
      ),
    ),
  )

export async function extractStars(program: string, path: string, snr: number, limit: number) {
  const directory = await mkdtemp(join(tmpdir(), 'vela-cells-'))

  try {
    await symlink(path, join(directory, 'frame.fits'))
    await run(program, ['-f', join(directory, 'frame.fits'), '-extract', String(snr), '-s', String(limit)])

    return readStarList(await readFile(join(directory, 'frame.csv'), 'utf8'))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

export const measureWithAstap =
  (stars: Pick<StarSettings, 'program' | 'analyseSnr' | 'listLimit'>, grid: { readonly columns: number; readonly rows: number }): MeasureFile =>
  async path => {
    const [listed, fits] = await Promise.all([extractStars(stars.program, path, stars.analyseSnr, stars.listLimit), readFile(path).then(readFits)])
    const size = { width: fits.width, height: fits.height }

    return { size, counts: countStars(listed, size, grid), levels: cellLevels(fits.pixels, size, grid), headerScale: arcsecPerPixel(fits.header) ?? undefined, site: siteOf(fits.header) }
  }

export interface NightOptions {
  readonly recordsFolder: string
  readonly framesFolder: string
  readonly outFolder: string
  readonly sweepPrefix: string
  readonly settings: SweepSettings
  readonly measure: MeasureFile
  readonly now: () => number
}

export const labelNight = (options: NightOptions): Effect.Effect<NightResult, CellRecordsUnreadable | CellOutputUnwritable> =>
  Effect.gen(function* () {
    const { recordsFolder, framesFolder, outFolder, sweepPrefix, settings, measure, now } = options
    const started = now()
    const records = (yield* readFrameRecords(join(recordsFolder, 'frames.jsonl'))).filter(record => record.sweep.startsWith(sweepPrefix))
    const failures: Array<FrameFailure> = []
    const measured = new Map<SweepId, Array<MeasuredFrame & Pick<FileMeasure, 'site'>>>()

    for (const record of records) {
      const found = yield* Effect.tryPromise({ try: () => measure(join(framesFolder, record.file)), catch: reasonOf }).pipe(Effect.result)

      if (found._tag === 'Failure') {
        failures.push({ file: record.file, reason: found.failure })
        continue
      }

      measured.set(record.sweep, [...(measured.get(record.sweep) ?? []), { record, ...found.success }])
    }

    const placed = [...measured].flatMap(([sweep, frames]) => {
      const site = frames.find(frame => frame.site !== undefined)?.site
      if (site !== undefined) return [{ sweep, labelled: labelSweep(frames, settings, site) }]
      failures.push(...frames.map(frame => ({ file: frame.record.file, reason: 'no frame of its sweep has SITELAT and SITELONG in its header' })))
      return []
    })
    const frameLines = placed.flatMap(({ labelled }) => labelled.frames.map(frame => JSON.stringify(frame)))
    const edgeLines = placed.flatMap(({ sweep, labelled }) => labelled.edges.map(edge => JSON.stringify({ sweep, ...edge })))
    const write = (name: string, lines: ReadonlyArray<string>) =>
      Effect.tryPromise({ try: () => writeFile(join(outFolder, name), lines.map(line => `${line}\n`).join('')), catch: cause => new CellOutputUnwritable({ path: join(outFolder, name), reason: reasonOf(cause) }) })

    yield* Effect.tryPromise({ try: () => mkdir(outFolder, { recursive: true }), catch: cause => new CellOutputUnwritable({ path: outFolder, reason: reasonOf(cause) }) })
    yield* write('cells.jsonl', frameLines)
    yield* write('edges.jsonl', edgeLines)

    return { frames: frameLines.length, edges: edgeLines.length, failures, seconds: (now() - started) / 1000 }
  })
