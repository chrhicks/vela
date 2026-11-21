import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Data, Effect, Schema } from 'effect'
import { SweepColumnFields, SweepFrameFields, type NightName, type SweepId } from '../../state/entries.ts'
import { readHorizon, type HorizonUnreadable } from '../horizon/file.ts'
import { Horizon } from '../horizon/horizon.ts'
import { EdgeRecord } from './cell-record.ts'
import { binsOfSweep, mergeSweep, type SweepBin, type TimedColumn } from './horizon-build.ts'
import type { SweepSettings } from './settings.ts'

export class HorizonRecordsUnreadable extends Data.TaggedError('HorizonRecordsUnreadable')<{ readonly path: string; readonly reason: string }> {}

export class HorizonUnwritable extends Data.TaggedError('HorizonUnwritable')<{ readonly path: string; readonly reason: string }> {}

export class SweepNotOne extends Data.TaggedError('SweepNotOne')<{ readonly prefix: string; readonly found: ReadonlyArray<string> }> {}

export interface HorizonResult {
  readonly sweep: string
  readonly fromCells: number
  readonly fromColumns: number
  readonly unknown: number
  readonly kept: number
  readonly backup: string | undefined
}

export interface HorizonOptions {
  readonly recordsFolder: string
  readonly night: NightName
  readonly out: string
  readonly sweepPrefix: string
  readonly settings: Pick<SweepSettings, 'columnDegrees'>
  readonly now: () => number
}

const ColumnLine = Schema.Struct(SweepColumnFields)

const FrameTime = Schema.Struct({ sweep: SweepFrameFields.sweep, column: SweepFrameFields.column, at: SweepFrameFields.at })

const reasonOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

const present = (path: string) => Effect.promise(() => stat(path).then(() => true, () => false))

const readLines = <S extends Schema.ConstraintDecoder<unknown>>(path: string, schema: S) => {
  const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(schema))

  return Effect.tryPromise({ try: () => readFile(path, 'utf8'), catch: cause => new HorizonRecordsUnreadable({ path, reason: reasonOf(cause) }) }).pipe(
    Effect.flatMap(text =>
      Effect.forEach(
        text.split('\n').filter(line => line.trim() !== ''),
        (line, index) => decode(line).pipe(Effect.mapError(error => new HorizonRecordsUnreadable({ path, reason: `line ${index + 1}: ${error.message}` }))),
      ),
    ),
  )
}

const stamp = (time: number) => new Date(time).toISOString().replace(/[:.]/g, '-')

const unwritable = (path: string) => (cause: unknown) => new HorizonUnwritable({ path, reason: reasonOf(cause) })

export const buildHorizon = (options: HorizonOptions): Effect.Effect<HorizonResult, HorizonRecordsUnreadable | HorizonUnwritable | HorizonUnreadable | SweepNotOne> =>
  Effect.gen(function* () {
    const { recordsFolder, night, out, sweepPrefix, settings, now } = options
    const columnsPath = join(recordsFolder, 'columns.jsonl')
    const edgesPath = join(recordsFolder, 'edges.jsonl')
    const columnLines = (yield* readLines(columnsPath, ColumnLine)).filter(line => line.sweep.startsWith(sweepPrefix))
    const edgeLines = (yield* present(edgesPath)) ? (yield* readLines(edgesPath, EdgeRecord)).filter(line => line.sweep.startsWith(sweepPrefix)) : []
    const sweeps = [...new Set<SweepId>([...columnLines, ...edgeLines].map(line => line.sweep))]

    if (sweeps.length !== 1) return yield* new SweepNotOne({ prefix: sweepPrefix, found: sweeps })

    const [sweep] = sweeps as [SweepId]
    const frameTimes = (yield* readLines(join(recordsFolder, 'frames.jsonl'), FrameTime)).filter(line => line.sweep === sweep)
    const lastFrame = new Map<number, number>()

    for (const { column, at } of frameTimes) lastFrame.set(column, Math.max(lastFrame.get(column) ?? at, at))

    const sweepEnded = Math.max(...frameTimes.map(frame => frame.at), 0)
    const columns: ReadonlyArray<TimedColumn> = columnLines.map(line => ({ ...line, at: lastFrame.get(line.column) ?? sweepEnded }))
    const bins: ReadonlyArray<SweepBin> = binsOfSweep(columns, edgeLines, settings)
    const existed = yield* present(out)
    const existing = yield* readHorizon(out)
    const merged = mergeSweep(existing, bins, { sweep, night })
    const backup = existed ? `${out}.bak-${stamp(now())}` : undefined

    yield* Effect.tryPromise({ try: () => mkdir(dirname(out), { recursive: true }), catch: unwritable(dirname(out)) })

    if (backup !== undefined) yield* Effect.tryPromise({ try: () => copyFile(out, backup), catch: unwritable(backup) })

    const partial = `${out}.partial`

    yield* Effect.tryPromise({
      try: () => writeFile(partial, `${JSON.stringify(Schema.encodeSync(Horizon)(merged))}\n`).then(() => rename(partial, out)),
      catch: unwritable(out),
    })

    return {
      sweep,
      fromCells: bins.filter(bin => bin.from === 'cells').length,
      fromColumns: bins.filter(bin => bin.from === 'column').length,
      unknown: merged.altitudesDegrees.filter(altitude => altitude === null).length,
      kept: existing.altitudesDegrees.filter((altitude, bin) => altitude !== null && !bins.some(given => given.bin === bin)).length,
      backup,
    }
  })
