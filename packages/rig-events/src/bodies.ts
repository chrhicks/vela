import { Schema } from 'effect'
import { EpochMs, SkyPosition, SourceId } from './primitives.ts'
import { ImageId, State } from './wire.ts'

export const CriaStateBody = Schema.Struct({
  origin: Schema.String,
  freshness: Schema.Literals(['observed', 'qualified']),
  state: State,
})

const JournalReply = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('answered'), body: Schema.optionalKey(Schema.Json) }),
  Schema.Struct({ kind: Schema.Literal('refused'), code: Schema.String, message: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('lost'), message: Schema.String }),
])

export const CriaExchangeBody = Schema.Struct({
  origin: Schema.String,
  ms: Schema.Number,
  method: Schema.Literals(['GET', 'POST']),
  route: Schema.String,
  status: Schema.NullOr(Schema.Number),
  command: Schema.NullOr(
    Schema.Struct({
      requestId: Schema.String,
      deviceId: Schema.String,
      kind: Schema.String,
      parameters: Schema.optionalKey(Schema.Json),
    }),
  ),
  reply: JournalReply,
})

export const CriaImageBody = Schema.Struct({
  origin: Schema.String,
  imageId: Schema.String,
  operationId: Schema.String,
  bytes: Schema.Number,
  sha256: Schema.String,
  verdict: Schema.Literals(['intact', 'damaged', 'gone', 'failed']),
})

export const CriaStreamBody = Schema.Struct({
  origin: Schema.String,
  event: Schema.Literals(['opened', 'ended']),
  message: Schema.NullOr(Schema.String),
})

const ImageRef = Schema.Struct({
  uri: Schema.String.pipe(Schema.check(Schema.isPattern(/^file:\/\/\//))),
  bytes: Schema.Number,
  sha256: Schema.NullOr(Schema.String),
})

export const FrameBody = Schema.Struct({
  runId: Schema.String,
  attempt: Schema.Int,
  startedAt: Schema.String,
  settledAt: Schema.String,
  exposureSeconds: Schema.Number,
  frameType: Schema.Literals(['light', 'dark', 'flat', 'dark-flat', 'bias']),
  subject: Schema.NullOr(Schema.Struct({ targetId: Schema.String, name: Schema.String, catalog: Schema.String })),
  outcome: Schema.Literals(['saved', 'unsaved', 'save-failed', 'lost', 'failed', 'uncertain', 'stopped']),
  image: Schema.NullOr(
    Schema.Struct({
      id: ImageId,
      capturedAt: Schema.String,
      capturedAtSource: Schema.Literals(['camera', 'server-estimate']),
      receivedAt: Schema.String,
      width: Schema.Int,
      height: Schema.Int,
      ref: Schema.NullOr(ImageRef),
    }),
  ),
  statistics: Schema.NullOr(Schema.Struct({ detectedStars: Schema.Number, medianHfrPixels: Schema.NullOr(Schema.Number) })),
  origin: Schema.Literals(['capture-run', 'alignment-trial', 'framing', 'autofocus', 'import']),
})

const PlateWcs = Schema.Struct({
  width: Schema.Number,
  height: Schema.Number,
  referenceX: Schema.Number,
  referenceY: Schema.Number,
  raDegrees: Schema.Number,
  decDegrees: Schema.Number,
  cd: Schema.Tuple([Schema.Number, Schema.Number, Schema.Number, Schema.Number]),
})

const Hint = Schema.NullOr(Schema.Struct({ raDegrees: Schema.Number, decDegrees: Schema.Number, radiusDegrees: Schema.Number }))

export const SolveBody = Schema.Union([
  Schema.Struct({
    status: Schema.Literal('solved'),
    imageId: ImageId,
    solverVersion: Schema.String,
    solveMs: Schema.Number,
    hint: Hint,
    centre: SkyPosition,
    wcs: PlateWcs,
  }),
  Schema.Struct({
    status: Schema.Literal('no-solution'),
    imageId: ImageId,
    solverVersion: Schema.String,
    solveMs: Schema.Number,
    hint: Hint,
    reason: Schema.Literals(['no-match', 'too-few-stars', 'timeout', 'image-missing', 'image-unreadable', 'solver-error']),
  }),
])

export const SessionBody = Schema.Struct({
  phase: Schema.Literals(['started', 'ended']),
  setupId: Schema.String,
  mode: Schema.Literals(['observing', 'indoors']),
  note: Schema.NullOr(Schema.String),
})

export const GapBody = Schema.Struct({
  source: SourceId,
  from: EpochMs,
  to: Schema.NullOr(EpochMs),
  reason: Schema.Literals(['dropped', 'disconnected', 'disk', 'instance-restart']),
  dropped: Schema.NullOr(Schema.Int),
})

const PointingSummary = Schema.Struct({
  imageId: ImageId,
  at: EpochMs,
  epoch: Schema.Int,
  errorArcmin: Schema.Struct({ east: Schema.Number, north: Schema.Number, total: Schema.Number }),
  timeTrust: Schema.Literals(['camera', 'server-estimate']),
})

export const MountPositionBody = Schema.Struct({
  state: Schema.Literals(['unknown', 'known', 'moving', 'uncertain']),
  since: EpochMs,
  reason: Schema.String,
  lastFix: Schema.NullOr(PointingSummary),
})

export const pointingRejectReasons = [
  'no-solution',
  'not-a-pointing-frame',
  'bad-capture-time',
  'no-mount-sample',
  'mount-sample-stale',
  'mount-moved-during-exposure',
  'exposure-spans-epochs',
  'no-site',
  'offset-undefined',
  'mount-not-covered',
  'solve-missing',
  'frame-missing',
] as const

export const PointingFixBody = Schema.Union([
  Schema.Struct({
    outcome: Schema.Literal('fix'),
    fix: PointingSummary,
    effect: Schema.Union([
      Schema.Struct({ kind: Schema.Literal('restores-known') }),
      Schema.Struct({ kind: Schema.Literal('history-only'), reason: Schema.Literals(['older-epoch', 'server-estimate', 'expired']) }),
    ]),
  }),
  Schema.Struct({ outcome: Schema.Literal('rejected'), imageId: ImageId, reason: Schema.Literals(pointingRejectReasons) }),
])

export type CriaStateBody = typeof CriaStateBody.Type

export type CriaExchangeBody = typeof CriaExchangeBody.Type

export type CriaImageBody = typeof CriaImageBody.Type

export type CriaStreamBody = typeof CriaStreamBody.Type

export type FrameBody = typeof FrameBody.Type

export type SolveBody = typeof SolveBody.Type

export type SessionBody = typeof SessionBody.Type

export type GapBody = typeof GapBody.Type

export type MountPositionBody = typeof MountPositionBody.Type

export type PointingFixBody = typeof PointingFixBody.Type
