import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Data, Effect, Schema } from 'effect'
import { FrameClass, NightName, PointingSource, SweepId } from '../../state/entries.ts'
import { EdgeKind, type HorizonSweep, type MapUnavailableReason, type SweepFile, type SweepFramePoint } from '../../state/horizon-sweep.ts'
import type { Horizon, HorizonOrigin } from '../horizon/horizon.ts'

class MapUnavailable extends Data.TaggedError('MapUnavailable')<{ readonly reason: MapUnavailableReason; readonly night: NightName | null; readonly file: SweepFile | null }> {}

const binsAround = 360

const SweepOf = Schema.Struct({ sweep: SweepId })

const FrameLine = Schema.Struct({
  sweep: SweepId,
  class: FrameClass,
  pointing: Schema.Struct({ source: PointingSource, altitudeDegrees: Schema.Number, azimuthDegrees: Schema.Number }),
})

const EdgeLine = Schema.Struct({ sweep: SweepId, bin: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: binsAround - 1 })), how: EdgeKind })

const parseLine = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))

const sweepOf = Schema.decodeUnknownEffect(SweepOf)

const isMissing = (cause: unknown) => cause instanceof Error && 'code' in cause && cause.code === 'ENOENT'

const unavailable = (reason: MapUnavailableReason, night: NightName | null, file: SweepFile | null) => new MapUnavailable({ reason, night, file })

const linesOf = <S extends Schema.ConstraintDecoder<unknown>>(folder: string, night: NightName, file: SweepFile, sweeps: ReadonlySet<SweepId>, line: S) => {
  const decode = Schema.decodeUnknownEffect(line)

  return Effect.tryPromise({ try: () => readFile(join(folder, file), 'utf8'), catch: cause => unavailable(isMissing(cause) ? 'missing' : 'unreadable', night, file) }).pipe(
    Effect.flatMap(text =>
      Effect.forEach(
        text.split('\n').filter(row => row.trim() !== ''),
        row =>
          parseLine(row).pipe(
            Effect.flatMap(body => sweepOf(body).pipe(Effect.map(({ sweep }) => ({ sweep, body })))),
            Effect.flatMap(({ sweep, body }) => (sweeps.has(sweep) ? decode(body).pipe(Effect.map(found => [found])) : Effect.succeed([]))),
          ),
        { concurrency: 1 },
      ),
    ),
    Effect.map(rows => rows.flat()),
    Effect.mapError(error => (error instanceof MapUnavailable ? error : unavailable('unreadable', night, file))),
  )
}

interface SweepRecords {
  readonly frames: ReadonlyArray<SweepFramePoint>
  readonly edges: ReadonlyMap<number, EdgeKind>
}

const keyOf = (origin: HorizonOrigin) => `${origin.night}/${origin.sweep}`

const recordsOfNight = (recordsFolder: string, night: NightName, sweeps: ReadonlySet<SweepId>) =>
  Effect.gen(function* () {
    const folder = join(recordsFolder, night)
    const frames = yield* linesOf(folder, night, 'frames.jsonl', sweeps, FrameLine)
    const edges = yield* linesOf(folder, night, 'edges.jsonl', sweeps, EdgeLine)

    return [...sweeps].map((sweep): readonly [string, SweepRecords] => [
      keyOf({ sweep, night }),
      {
        frames: frames.filter(frame => frame.sweep === sweep).map(({ class: kind, pointing }) => ({ altitudeDegrees: pointing.altitudeDegrees, azimuthDegrees: pointing.azimuthDegrees, source: pointing.source, class: kind })),
        edges: new Map(edges.filter(edge => edge.sweep === sweep).map(edge => [edge.bin, edge.how] as const)),
      },
    ])
  })

const originsOf = (horizon: Horizon): ReadonlyArray<HorizonOrigin> => {
  const seen = new Map<string, HorizonOrigin>()

  for (const origin of horizon.origins) if (origin !== null && !seen.has(keyOf(origin))) seen.set(keyOf(origin), origin)

  return [...seen.values()]
}

export const readHorizonSweep = (recordsFolder: string, horizon: Horizon): Effect.Effect<HorizonSweep> =>
  Effect.gen(function* () {
    const origins = originsOf(horizon)

    if (origins.length === 0) return yield* unavailable('no-origins', null, null)

    const nights = [...new Set(origins.map(origin => origin.night))].sort()
    const records = new Map<string, SweepRecords>()

    for (const night of nights) {
      const sweeps = new Set(origins.filter(origin => origin.night === night).map(origin => origin.sweep))

      for (const [key, found] of yield* recordsOfNight(recordsFolder, night, sweeps)) records.set(key, found)
    }

    for (const origin of origins) {
      const found = records.get(keyOf(origin))

      if (found === undefined || found.frames.length === 0) return yield* unavailable('no-frames', origin.night, 'frames.jsonl')

      if (found.edges.size === 0) return yield* unavailable('no-edges', origin.night, 'edges.jsonl')
    }

    return {
      status: 'available' as const,
      nights,
      frames: origins.flatMap(origin => records.get(keyOf(origin))?.frames ?? []),
      edges: horizon.origins.map((origin, bin) => (origin === null ? null : (records.get(keyOf(origin))?.edges.get(bin) ?? null))),
    }
  }).pipe(Effect.catchTag('MapUnavailable', ({ reason, night, file }) => Effect.succeed<HorizonSweep>({ status: 'unavailable', reason, night, file })))
