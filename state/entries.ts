import { Data, Effect, Option, Result, Schema, SchemaTransformation } from 'effect'
import { FilterAnswer, Refusal } from './commands.ts'
import { StreamPosition, WireBody, type Entry } from './entry.ts'
import { Check, CheckedFrames, FirstFramesVerdict } from './first-frames-check.ts'
import { ReviewId, ReviewOutcome, ReviewUsage } from './review-answer.ts'
import { RunTarget } from './targets.ts'

export const StartToken = Schema.String.pipe(Schema.brand('StartToken'))

export type StartToken = typeof StartToken.Type

export const restartDetail = 'Vela restarted while this was under way; it was not resumed'

export const RunId = Schema.NonEmptyString.pipe(Schema.brand('RunId'))

export type RunId = typeof RunId.Type

export const NightName = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)).pipe(Schema.brand('NightName'))

export type NightName = typeof NightName.Type

export const FrameFile = Schema.NonEmptyString.pipe(Schema.brand('FrameFile'))

export type FrameFile = typeof FrameFile.Type

export const Operation = Schema.Literals(['align', 'focus', 'centre', 'test', 'flatExposure', 'sweep'])

export type Operation = typeof Operation.Type

export const operationObjects: Readonly<Record<Operation, string>> = { align: 'polar-align', focus: 'autofocus', centre: 'centre', test: 'test-frame', flatExposure: 'flat-exposure', sweep: 'horizon-sweep' }

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

export const SkyPosition = Schema.Struct({ raDegrees: Schema.Number, decDegrees: Schema.Number })

export type SkyPosition = typeof SkyPosition.Type

export const RunStarted = entryOf('vela.run.started', {
  run: RunId,
  object: RunObjectName,
  frameType: FrameType,
  exposureSeconds: Schema.Number,
  count: Schema.optionalKey(Count),
  target: Schema.optionalKey(RunTarget),
  aim: Schema.optionalKey(SkyPosition),
  sequence: Schema.optionalKey(Schema.String),
  gain: Schema.optionalKey(Schema.Number),
  offset: Schema.optionalKey(Schema.Number),
  filter: Schema.optionalKey(FilterAnswer),
})

export const RunExposed = entryOf('vela.run.exposed', { run: RunId, frame: Count })

export const RunFailed = entryOf('vela.run.failed', { run: RunId })

export const RunEnded = entryOf('vela.run.ended', { run: RunId, reason: RunEnding, detail: Schema.optionalKey(Schema.String) })

export const FrameKept = entryOf('vela.frame', { night: NightName, file: FrameFile, sequence: Schema.optionalKey(Schema.String) })

export const FrameMeasured = entryOf('vela.frame.stats', {
  night: NightName,
  file: FrameFile,
  sequence: Schema.optionalKey(Schema.String),
  centre: Schema.optionalKey(Schema.NullOr(SkyPosition)),
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

export const GuiderEvent = Schema.Literals(['GuideStep', 'StartGuiding', 'GuidingStopped', 'LoopingExposures', 'LoopingExposuresStopped', 'StartCalibration', 'StarSelected', 'StarLost', 'Paused', 'Resumed', 'SettleBegin', 'Settling', 'SettleDone'])

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
    Status: Schema.optionalKey(Schema.Union([Schema.Number, Schema.String])),
    Error: Schema.optionalKey(Schema.String),
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

export const StartId = Schema.String.pipe(Schema.brand('StartId'))

export type StartId = typeof StartId.Type

export const StartStep = Schema.Literals(['cooler', 'home', 'stop-guiding', 'centre', 'autofocus', 'guiding', 'capture'])

export type StartStep = typeof StartStep.Type

export const StepOutcome = Schema.Literals(['started', 'done', 'failed', 'stopped'])

export type StepOutcome = typeof StepOutcome.Type

export const TargetStep = entryOf('vela.target.step', { start: StartId, target: RunTarget, step: StartStep, outcome: StepOutcome, refusal: Schema.optionalKey(Refusal) })

export type TargetStepBody = typeof TargetStep.Type['body']

export const FirstFramesAnnounced = entryOf('vela.first-frames', { run: RunId, verdict: FirstFramesVerdict, frames: CheckedFrames, checks: Schema.Array(Check) })

export type FirstFramesBody = typeof FirstFramesAnnounced.Type['body']

export const CommandPressed = entryOf('vela.command.pressed', { id: Schema.String, command: Schema.String, key: Schema.optionalKey(Schema.String) })

export const CommandAnswered = entryOf('vela.command.answered', { id: Schema.String, command: Schema.String })

export const StackGrew = entryOf('vela.stack', { night: NightName, sequence: Schema.String, frames: Schema.Number, leftOut: Schema.Number })

export const ReviewAsked = entryOf('vela.review.asked', {
  review: ReviewId,
  run: RunId,
  night: NightName,
  file: FrameFile,
  models: Schema.Array(Schema.NonEmptyString),
})

export const ReviewAnswered = entryOf('vela.review.answer', {
  review: ReviewId,
  night: NightName,
  file: FrameFile,
  model: Schema.NonEmptyString,
  seconds: Schema.Number,
  outcome: ReviewOutcome,
  usage: Schema.optionalKey(ReviewUsage),
})

export const PierSide = Schema.Literals(['PIER_WEST', 'PIER_EAST'])

export type PierSide = typeof PierSide.Type

export const RehearsalId = Schema.String.pipe(Schema.brand('RehearsalId'))

export type RehearsalId = typeof RehearsalId.Type

export const RehearsalEnding = Schema.Literals(['finished', 'stopped', 'pressed', 'restarted'])

export type RehearsalEnding = typeof RehearsalEnding.Type

export const MoveOutcome = Schema.Literals(['arrived', 'alert', 'refused'])

export type MoveOutcome = typeof MoveOutcome.Type

export const SweepStarted = entryOf('vela.sweep.started', { rehearsal: RehearsalId, total: Count })

export const SweepMoved = entryOf('vela.sweep.move', {
  rehearsal: RehearsalId,
  move: Count,
  total: Count,
  column: Count,
  altitudeDegrees: Schema.Number,
  azimuthDegrees: Schema.Number,
  hourAngleDegrees: Schema.Number,
  declinationDegrees: Schema.Number,
  predictedPierSide: PierSide,
  flipExpected: Schema.Boolean,
  outcome: MoveOutcome,
  reason: Schema.optionalKey(Schema.String),
  EQUATORIAL_EOD_COORD: Schema.optionalKey(Schema.Struct({ RA: Schema.Number, DEC: Schema.Number })),
  TELESCOPE_PIER_SIDE: Schema.optionalKey(PierSide),
})

export type SweepMoveBody = typeof SweepMoved.Type['body']

export const SweepEnded = entryOf('vela.sweep.ended', { rehearsal: RehearsalId, total: Count, ending: RehearsalEnding })

export const SweepId = Schema.String.pipe(Schema.brand('SweepId'))

export type SweepId = typeof SweepId.Type

export const FrameClass = Schema.Literals(['sky', 'edge', 'blocked'])

export type FrameClass = typeof FrameClass.Type

export const PointingSource = Schema.Literals(['solve', 'commanded+offset', 'commanded'])

export type PointingSource = typeof PointingSource.Type

export const EdgeHow = Schema.Literals(['edge-in-frame', 'between-frames', 'open-to-floor', 'blocked-to-ceiling'])

export type EdgeHow = typeof EdgeHow.Type

export const SweepRunStarted = entryOf('vela.sweep.run.started', { sweep: SweepId, exposureSeconds: Schema.Number, columns: Count })

export const SweepSolve = Schema.Union([
  Schema.Struct({ solved: Schema.Literal(true), raDegrees: Schema.Number, decDegrees: Schema.Number, rotationDegrees: Schema.optionalKey(Schema.Number), scaleArcsecPerPixel: Schema.optionalKey(Schema.Number) }),
  Schema.Struct({ solved: Schema.Literal(false), reason: Schema.String }),
])

export const SweepFrameFields = {
  sweep: SweepId,
  column: Count,
  azimuthDegrees: Schema.Number,
  file: Schema.String,
  at: Schema.Number,
  commanded: Schema.Struct({ altitudeDegrees: Schema.Number, azimuthDegrees: Schema.Number, hourAngleDegrees: Schema.Number, declinationDegrees: Schema.Number }),
  EQUATORIAL_EOD_COORD: Schema.optionalKey(Schema.Struct({ RA: Schema.Number, DEC: Schema.Number })),
  TELESCOPE_PIER_SIDE: Schema.optionalKey(PierSide),
  moveProblem: Schema.optionalKey(Schema.String),
  solve: SweepSolve,
  stars: Count,
  starsReason: Schema.optionalKey(Schema.String),
  baseline: Schema.optionalKey(Schema.Number),
  class: FrameClass,
  pointing: Schema.Struct({ source: PointingSource, altitudeDegrees: Schema.Number, azimuthDegrees: Schema.Number }),
}

export const SweepFramed = entryOf('vela.sweep.frame', SweepFrameFields)

export type SweepFrameBody = typeof SweepFramed.Type['body']

export const SweepColumnFields = { sweep: SweepId, column: Count, azimuthDegrees: Schema.Number, edgeAltitudeDegrees: Schema.Number, how: EdgeHow, frames: Count }

export const SweepColumned = entryOf('vela.sweep.column', SweepColumnFields)

export type SweepColumnBody = typeof SweepColumned.Type['body']

export const SweepAlerted = entryOf('vela.sweep.alert', { sweep: SweepId, column: Count, text: Schema.String })

export const SweepRunEnded = entryOf('vela.sweep.run.ended', { sweep: SweepId, columns: Count, ending: RehearsalEnding })

export const VelaStarted = entryOf('vela.started', { token: StartToken })

export const RigEntry = Schema.Union([VelaStarted, SweepStarted, SweepMoved, SweepEnded, SweepRunStarted, SweepFramed, SweepColumned, SweepAlerted, SweepRunEnded, ReviewAsked, ReviewAnswered, TargetStep, FirstFramesAnnounced, StackGrew, CommandPressed, CommandAnswered, RunStarted, RunExposed, RunFailed, RunEnded, FrameKept, FrameMeasured, DeviceReported, RigConnected, RigLink, GuiderReported, AlignStarted, AlignSolved, FocusStarted, FocusSampled, FocusBest, FilterAnswered, FlatExposureTried, GuiderReplied])

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
