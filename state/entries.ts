import { Data, Effect, Option, Result, Schema, SchemaTransformation } from 'effect'
import { FilterAnswer } from './commands.ts'
import { StreamPosition, WireBody, type Entry } from './entry.ts'

export const RunId = Schema.NonEmptyString.pipe(Schema.brand('RunId'))

export type RunId = typeof RunId.Type

export const NightName = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)).pipe(Schema.brand('NightName'))

export type NightName = typeof NightName.Type

export const FrameFile = Schema.NonEmptyString.pipe(Schema.brand('FrameFile'))

export type FrameFile = typeof FrameFile.Type

export const Operation = Schema.Literals(['align', 'focus', 'centre', 'test', 'flatExposure'])

export type Operation = typeof Operation.Type

export const operationObjects: Readonly<Record<Operation, string>> = { align: 'polar-align', focus: 'autofocus', centre: 'centre', test: 'test-frame', flatExposure: 'flat-exposure' }

export const RunObject = Schema.Union([Schema.TaggedStruct('Operation', { operation: Operation }), Schema.TaggedStruct('Target', { name: Schema.String })])

export type RunObject = typeof RunObject.Type

const operationNamed: ReadonlyMap<string, Operation> = new Map(Operation.literals.map(operation => [operationObjects[operation], operation]))

const runObjectOf = (object: string): RunObject => {
  const operation = operationNamed.get(object)

  return operation === undefined ? { _tag: 'Target', name: object } : { _tag: 'Operation', operation }
}

const objectOf = (subject: RunObject) => (subject._tag === 'Operation' ? operationObjects[subject.operation] : subject.name)

const RunObjectName = Schema.String.pipe(Schema.decodeTo(RunObject, SchemaTransformation.transform<RunObject, string>({ decode: runObjectOf, encode: objectOf })))

export const CalibrationType = Schema.Literals(['dark', 'flat', 'bias'])

export type CalibrationType = typeof CalibrationType.Type

export const FrameType = Schema.Union([Schema.Literal('light'), CalibrationType])

export type FrameType = typeof FrameType.Type

export const RunEnding = Schema.Literals(['done', 'stopped', 'failures', 'refused', 'interrupted', 'unknown'])

export type RunEnding = typeof RunEnding.Type

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

const entryOf = <const Kind extends string, const Body extends Schema.Struct.Fields>(kind: Kind, body: Body) =>
  Schema.Struct({ seq: StreamPosition, at: Schema.Number, kind: Schema.Literal(kind), body: Schema.Struct(body) })

export const RunStarted = entryOf('vela.run.started', {
  run: RunId,
  object: RunObjectName,
  frameType: FrameType,
  exposureSeconds: Schema.Number,
  count: Schema.optionalKey(Count),
})

export const RunExposed = entryOf('vela.run.exposed', { run: RunId, frame: Count })

export const RunFailed = entryOf('vela.run.failed', { run: RunId })

export const RunEnded = entryOf('vela.run.ended', { run: RunId, reason: RunEnding, detail: Schema.optionalKey(Schema.String) })

export const FrameKept = entryOf('vela.frame', { night: NightName, file: FrameFile, sequence: Schema.optionalKey(Schema.String) })

export const FrameMeasured = entryOf('vela.frame.stats', {
  night: NightName,
  file: FrameFile,
  sequence: Schema.optionalKey(Schema.String),
  stars: Schema.NullOr(Count),
  hfdPixels: Schema.NullOr(Schema.Number),
  elongation: Schema.NullOr(Schema.Number),
  sky: Schema.Number,
  noise: Schema.Number,
})

export const DeviceReported = entryOf('wire', WireBody.fields)

export const RigConnected = entryOf('client.connected', {})

export const LinkTarget = Schema.Literals(['indiserver', 'phd2'])

export const LinkStatus = Schema.Literals(['connected', 'closed', 'failed'])

export type LinkStatus = typeof LinkStatus.Type

export const RigLink = entryOf('client.connection', { target: LinkTarget, status: LinkStatus })

export const GuiderEvent = Schema.Literals(['GuideStep', 'StartGuiding', 'GuidingStopped', 'LoopingExposures', 'LoopingExposuresStopped', 'StartCalibration', 'StarSelected', 'StarLost', 'Paused', 'Resumed'])

export type GuiderEvent = typeof GuiderEvent.Type

export const GuiderReported = Schema.Struct({
  seq: StreamPosition,
  at: Schema.Number,
  kind: Schema.TemplateLiteral(['phd2.', GuiderEvent]),
  body: Schema.Struct({
    Event: GuiderEvent,
    AvgDist: Schema.optionalKey(Schema.Number),
    SNR: Schema.optionalKey(Schema.Number),
    RADistanceRaw: Schema.optionalKey(Schema.Number),
    DECDistanceRaw: Schema.optionalKey(Schema.Number),
  }),
})

export type GuiderReport = typeof GuiderReported.Type

export const isGuiderReport = Schema.is(GuiderReported)

export const guiderDevice = 'phd2'

export const GuiderReplied = entryOf('phd2.reply', { id: Schema.String, result: Schema.optionalKey(Schema.Unknown), error: Schema.optionalKey(Schema.Struct({ message: Schema.String })) })

export const AlignStarted = entryOf('vela.align.started', { run: RunId })

const solveOutcome = <const Tag extends string>(tag: Tag) => Schema.withDecodingDefaultKey<Schema.Literal<Tag>>(Effect.succeed(tag))(Schema.Literal(tag))

const solveOf = <const Fields extends Schema.Struct.Fields>(fields: Fields) => Schema.Struct({ run: RunId, frame: Count, ...fields })

export const AlignSolve = Schema.Union([
  solveOf({ _tag: solveOutcome('Measured'), solved: Schema.Literal(true), altitudeArcmin: Schema.Number, azimuthArcmin: Schema.Number, totalArcmin: Schema.Number }),
  solveOf({ _tag: solveOutcome('Solved'), solved: Schema.Literal(true) }),
  solveOf({ _tag: solveOutcome('Failed'), solved: Schema.Literal(false), reason: Schema.String }),
])

export type AlignSolve = typeof AlignSolve.Type

export const AlignSolved = Schema.Struct({ seq: StreamPosition, at: Schema.Number, kind: Schema.Literal('vela.align.solve'), body: AlignSolve })

export const FocusStarted = entryOf('vela.focus.started', { run: RunId, positions: Schema.Array(Schema.Number) })

export const FocusSampled = entryOf('vela.focus.sample', { run: RunId, frame: Count, position: Schema.Number, hfd: Schema.NullOr(Schema.Number), stars: Count })

export const FocusBest = entryOf('vela.focus.best', { run: RunId, position: Schema.Number })

export const FlatVerdict = Schema.Literals(['trying', 'good', 'too-dark', 'too-bright', 'gave-up', 'not-measured', 'stopped', 'set-refused'])

export type FlatVerdict = typeof FlatVerdict.Type

export const FlatExposureTried = entryOf('vela.flats.exposure', { exposureSeconds: Schema.Number, sky: Schema.optionalKey(Schema.Number), verdict: FlatVerdict, nextSeconds: Schema.optionalKey(Schema.Number) })

export const FilterAnswered = entryOf('vela.filter', { filter: FilterAnswer })

export const RigEntry = Schema.Union([RunStarted, RunExposed, RunFailed, RunEnded, FrameKept, FrameMeasured, DeviceReported, RigConnected, RigLink, GuiderReported, AlignStarted, AlignSolved, FocusStarted, FocusSampled, FocusBest, FilterAnswered, FlatExposureTried, GuiderReplied])

export type RigEntry = typeof RigEntry.Type

export class MalformedEntry extends Data.TaggedError('MalformedEntry')<{
  readonly seq: StreamPosition
  readonly kind: string
  readonly issue: string
}> {}

export const isRigKind = Schema.is(Schema.Union(RigEntry.members.map(member => member.fields.kind)))

const decodeRigEntry = Schema.decodeUnknownResult(RigEntry)

export function readRigEntry(entry: Entry): Result.Result<Option.Option<RigEntry>, MalformedEntry> {
  if (!isRigKind(entry.kind)) return Result.succeed(Option.none())

  return decodeRigEntry(entry).pipe(
    Result.map(Option.some),
    Result.mapError(error => new MalformedEntry({ seq: entry.seq, kind: entry.kind, issue: error.message })),
  )
}
