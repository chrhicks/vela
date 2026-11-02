import { Schema } from 'effect'
import { EpochMs, EventId, SkyPosition, SourceId } from './primitives.ts'
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
  message: Schema.NullOr(Schema.String),
  provenance: Schema.NullOr(Schema.Struct({ requestId: Schema.String, operationId: Schema.NullOr(Schema.String), imageId: Schema.NullOr(Schema.String) })),
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

const AutofocusFit = Schema.Struct({
  position: Schema.Number,
  p: Schema.Number,
  a: Schema.Number,
  b: Schema.Number,
  rSquared: Schema.Number,
  minSamplePosition: Schema.Number,
})

const AutofocusLanding = Schema.Struct({
  position: Schema.Number,
  outcome: Schema.Literals(['confirmed', 'fell-back', 'unconfirmed']),
  bestSample: Schema.Struct({ position: Schema.Number, hfrPixels: Schema.Number }),
  tolerance: Schema.Number,
  attempts: Schema.Array(
    Schema.Struct({
      source: Schema.Literals(['fit', 'best-sample']),
      position: Schema.Number,
      sampleIndex: Schema.Int,
      hfrPixels: Schema.NullOr(Schema.Number),
      withinTolerance: Schema.Boolean,
    }),
  ),
})

const AutofocusSample = Schema.Struct({
  position: Schema.Number,
  detectedStars: Schema.Number,
  hfrPixels: Schema.NullOr(Schema.Number),
  capturedAt: Schema.String,
  pass: Schema.optionalKey(Schema.Literals(['coarse', 'fine', 'confirm'])),
  stars: Schema.Array(Schema.Struct({ x: Schema.Number, y: Schema.Number, snr: Schema.Number, hfr: Schema.Number })),
})

export const AutofocusBody = Schema.Struct({
  startedAt: Schema.String,
  settledAt: Schema.NullOr(Schema.String),
  phase: Schema.Literals(['setup', 'walking', 'fitting', 'confirming', 'complete', 'stopped', 'failed']),
  error: Schema.NullOr(Schema.String),
  startPosition: Schema.NullOr(Schema.Number),
  stepSize: Schema.Number,
  offsetSteps: Schema.Number,
  fineStepSize: Schema.Number,
  fineOffsetSteps: Schema.Number,
  confirmTolerance: Schema.Number,
  travel: Schema.NullOr(Schema.Struct({ min: Schema.Number, max: Schema.Number })),
  exposureSeconds: Schema.Number,
  fit: Schema.NullOr(AutofocusFit),
  landing: Schema.NullOr(AutofocusLanding),
  airTemperatureC: Schema.Struct({ start: Schema.NullOr(Schema.Number), end: Schema.NullOr(Schema.Number) }),
  samples: Schema.Array(AutofocusSample),
})

const AttestationItem = Schema.Struct({
  item: Schema.String,
  status: Schema.Literals(['match', 'changed', 'missing', 'unpinned']),
  pinned: Schema.NullOr(Schema.String),
  observed: Schema.NullOr(Schema.String),
})

export const AttestationBody = Schema.Struct({
  pinnedAt: Schema.String,
  items: Schema.Array(AttestationItem),
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

const AlignmentSample = Schema.Struct({ raDegrees: Schema.Number, decDegrees: Schema.Number, capturedAt: Schema.String })

const AlignmentMeasurement = Schema.Struct({
  altitudeArcsec: Schema.Number,
  azimuthArcsec: Schema.Number,
  totalArcsec: Schema.Number,
  correctionTarget: SkyPosition,
})

const AlignmentCoordinateSystem = Schema.Literals(['other', 'topocentric', 'j2000', 'j2050', 'b1950'])

const AlignmentMount = Schema.Struct({
  rightAscensionDegrees: Schema.Number,
  declinationDegrees: Schema.Number,
  coordinateSystem: Schema.Union([AlignmentCoordinateSystem, Schema.Literal('unknown')]),
  tracking: Schema.Boolean,
  trackingRate: Schema.optionalKey(Schema.Literals(['sidereal', 'lunar', 'solar', 'king'])),
  rightAscensionRateSecondsPerSiderealSecond: Schema.optionalKey(Schema.Number),
  declinationRateArcsecondsPerSecond: Schema.optionalKey(Schema.Number),
  pierSide: Schema.optionalKey(Schema.Literals(['east', 'west', 'unknown'])),
  slewing: Schema.Boolean,
  parked: Schema.Boolean,
  observedAt: Schema.String,
})

const AlignmentCamera = Schema.Struct({
  cameraName: Schema.String,
  sensorWidthPixels: Schema.Int,
  sensorHeightPixels: Schema.Int,
  pixelWidthMicrons: Schema.Number,
  pixelHeightMicrons: Schema.Number,
  binX: Schema.Int,
  binY: Schema.Int,
  width: Schema.Int,
  height: Schema.Int,
  startX: Schema.Int,
  startY: Schema.Int,
})

const AlignmentStep = Schema.Struct({
  labelBefore: Schema.String,
  labelAfter: Schema.String,
  excessArcmin: Schema.Number,
  baselineArcmin: Schema.Number,
  turnDegrees: Schema.Number,
  mountAngleBeforeDegrees: Schema.Number,
  mountAngleAfterDegrees: Schema.Number,
})

/** Which trial an alignment event belongs to, and its place in it: ids are `alignment:<runId>:<n>`, and `n` counts from the `run` event at 1. */
const AlignmentPart = {
  runId: Schema.String,
  n: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1))),
}

const AlignmentRun = {
  type: Schema.Literal('run'),
  ...AlignmentPart,
  folder: Schema.String,
  rigName: Schema.String,
  cameraId: Schema.String,
  telescopeId: Schema.String,
  cameraName: Schema.String,
  exposureSeconds: Schema.Number,
}

/**
 * One entry of an alignment trial. No body names a site or a sidereal time. A physical trial's site is the first mount snapshot of its
 * rig in the same run log file, and an offline trial's `run` names the simulator's latitude and its sidereal time at one instant.
 */
export const AlignmentBody = Schema.Union([
  Schema.Struct({ ...AlignmentRun, mode: Schema.Literal('physical') }),
  Schema.Struct({
    ...AlignmentRun,
    mode: Schema.Literal('offline'),
    simulator: Schema.Struct({ latitudeDegrees: Schema.Number, siderealTimeDegrees: Schema.Number, at: Schema.String }),
  }),
  Schema.Struct({
    type: Schema.Literal('frame'),
    ...AlignmentPart,
    original: Schema.Struct({ filename: Schema.String, bytes: Schema.Int, sha256: Schema.String }),
    capture: Schema.Struct({
      width: Schema.Int,
      height: Schema.Int,
      capturedAt: Schema.String,
      capturedAtSource: Schema.Literals(['camera', 'server-estimate']),
      color: Schema.Union([Schema.Struct({ kind: Schema.Literal('mono') }), Schema.Struct({ kind: Schema.Literal('bayer'), pattern: Schema.Literals(['rggb', 'grbg', 'gbrg', 'bggr']) })]),
    }),
    evidence: Schema.Struct({
      phase: Schema.Literals(['baseline', 'adjusting']),
      position: Schema.Int,
      solution: Schema.Struct({ ...SkyPosition.fields, capturedAt: Schema.String, wcs: PlateWcs }),
      sample: AlignmentSample,
      hint: SkyPosition,
      fieldHeightDegrees: Schema.Number,
      physical: Schema.optionalKey(Schema.Struct({ camera: AlignmentCamera, before: AlignmentMount, after: AlignmentMount })),
      offlinePointing: Schema.optionalKey(
        Schema.Struct({ rightAscensionDegrees: Schema.Number, declinationDegrees: Schema.Number, tracking: Schema.Boolean, coordinateSystem: AlignmentCoordinateSystem }),
      ),
    }),
  }),
  Schema.Struct({
    type: Schema.Literal('fit'),
    ...AlignmentPart,
    fixes: Schema.Array(Schema.Struct({ position: Schema.Int, sample: AlignmentSample })),
    polar: Schema.NullOr(
      Schema.Struct({
        axis: Schema.Tuple([Schema.Number, Schema.Number, Schema.Number]),
        altitudeArcsec: Schema.Number,
        azimuthArcsec: Schema.Number,
        totalArcsec: Schema.Number,
      }),
    ),
    verdict: Schema.Struct({
      status: Schema.Literals(['rigid', 'not-rigid']),
      missArcmin: Schema.Number,
      thresholdArcmin: Schema.Number,
      steps: Schema.Array(AlignmentStep),
    }),
  }),
  Schema.Struct({
    type: Schema.Literal('dropped'),
    ...AlignmentPart,
    position: Schema.Int,
    reason: Schema.Literals(['no-solve', 'rejected', 'capture-failed']),
    detail: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal('measurement'),
    ...AlignmentPart,
    sample: AlignmentSample,
    measurement: AlignmentMeasurement,
    tracking: Schema.Literal(true),
    mount: Schema.optionalKey(AlignmentMount),
  }),
  Schema.Struct({
    type: Schema.Literal('outcome'),
    ...AlignmentPart,
    phase: Schema.Literals(['finished', 'stopped', 'failed']),
    error: Schema.NullOr(Schema.String),
  }),
])

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

const SolveMeasured = Schema.Struct({
  arcsecPerPixel: Schema.Number,
  scaleError: Schema.Number,
  parity: Schema.Literals([1, -1]),
  hintOffsetDegrees: Schema.NullOr(Schema.Number),
  stars: Schema.NullOr(Schema.Number),
})

export const SolveResultBody = Schema.Struct({
  frameEventId: EventId,
  purpose: Schema.Literals(['framing', 'alignment']),
  solve: SolveBody,
  verdict: Schema.Union([
    Schema.Struct({ status: Schema.Literal('accepted'), measured: SolveMeasured, unchecked: Schema.Array(Schema.Literals(['stars', 'hint'])) }),
    Schema.Struct({ status: Schema.Literal('rejected'), measured: Schema.NullOr(SolveMeasured), reasons: Schema.Array(Schema.Literals(['no-match', 'few-stars', 'scale', 'parity', 'off-hint'])) }),
  ]),
})

export type SolveResultBody = typeof SolveResultBody.Type

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

export type AutofocusBody = typeof AutofocusBody.Type

export type AttestationBody = typeof AttestationBody.Type

export type AlignmentBody = typeof AlignmentBody.Type

export type SolveBody = typeof SolveBody.Type

export type SessionBody = typeof SessionBody.Type

export type GapBody = typeof GapBody.Type

export type MountPositionBody = typeof MountPositionBody.Type

export type PointingFixBody = typeof PointingFixBody.Type

export const AimBody = Schema.Struct({
  goalId: Schema.String,
  target: Schema.Struct({ raDegrees: Schema.Number, decDegrees: Schema.Number }),
  status: Schema.Literals(['aimed', 'missed', 'refused']),
  reason: Schema.Literals(['within-tolerance', 'outside-tolerance', 'budget', 'no-solve', 'interrupted', 'no-confidence', 'mount-unavailable', 'mount-held', 'outside-envelope']),
  elapsedMs: Schema.Number,
  corrections: Schema.Number,
  residualArcmin: Schema.NullOr(Schema.Number),
  toleranceArcmin: Schema.Number,
  maxCorrections: Schema.Number,
  maxElapsedMs: Schema.Number,
  gotoWarningArcmin: Schema.Number,
  gotoMissArcmin: Schema.NullOr(Schema.Number),
  gotoWarning: Schema.Boolean,
  confidence: Schema.Literals(['high', 'low', 'none']),
  pointingBudgetArcmin: Schema.NullOr(Schema.Number),
  blindTravelDegrees: Schema.NullOr(Schema.Number),
})
