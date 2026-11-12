import { Data, Option, Result, Schema } from 'effect'
import { StreamPosition, type Entry } from './entry.ts'

export const RunId = Schema.NonEmptyString.pipe(Schema.brand('RunId'))

export type RunId = typeof RunId.Type

export const NightName = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)).pipe(Schema.brand('NightName'))

export type NightName = typeof NightName.Type

export const FrameFile = Schema.NonEmptyString.pipe(Schema.brand('FrameFile'))

export type FrameFile = typeof FrameFile.Type

export const RunEnding = Schema.Literals(['done', 'stopped', 'refused', 'interrupted', 'unknown'])

export type RunEnding = typeof RunEnding.Type

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

const entryOf = <const Kind extends string, const Body extends Schema.Struct.Fields>(kind: Kind, body: Body) =>
  Schema.Struct({ seq: StreamPosition, at: Schema.Number, kind: Schema.Literal(kind), body: Schema.Struct(body) })

export const RunStarted = entryOf('vela.run.started', {
  run: RunId,
  object: Schema.String,
  frameType: Schema.String,
  exposureSeconds: Schema.Number,
  count: Schema.optionalKey(Count),
})

export const RunExposed = entryOf('vela.run.exposed', { run: RunId, frame: Count })

export const RunFailed = entryOf('vela.run.failed', { run: RunId })

export const RunEnded = entryOf('vela.run.ended', { run: RunId, reason: RunEnding })

export const FrameKept = entryOf('vela.frame', { night: NightName, file: FrameFile })

export const FrameMeasured = entryOf('vela.frame.stats', {
  night: NightName,
  file: FrameFile,
  stars: Schema.NullOr(Count),
  hfdPixels: Schema.NullOr(Schema.Number),
  elongation: Schema.NullOr(Schema.Number),
  sky: Schema.Number,
  noise: Schema.Number,
})

const members = [RunStarted, RunExposed, RunFailed, RunEnded, FrameKept, FrameMeasured] as const

export const RigEntry = Schema.Union(members)

export type RigEntry = typeof RigEntry.Type

export class MalformedEntry extends Data.TaggedError('MalformedEntry')<{
  readonly seq: StreamPosition
  readonly kind: string
  readonly issue: string
}> {}

const rigKinds: ReadonlySet<string> = new Set(members.map(member => member.fields.kind.literal))

const decodeRigEntry = Schema.decodeUnknownResult(RigEntry)

export function readRigEntry(entry: Entry): Result.Result<Option.Option<RigEntry>, MalformedEntry> {
  if (!rigKinds.has(entry.kind)) return Result.succeed(Option.none())

  return decodeRigEntry(entry).pipe(
    Result.map(Option.some),
    Result.mapError(error => new MalformedEntry({ seq: entry.seq, kind: entry.kind, issue: error.message })),
  )
}
