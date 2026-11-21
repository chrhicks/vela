import { Schema, SchemaTransformation } from 'effect'
import { NightName } from './entries.ts'
import { HorizonSource } from './horizon-source.ts'
import { TargetId } from './targets.ts'

export const horizonNightPath = '/horizon-night'

export const HorizonNightAsked = Schema.Struct({ target: Schema.NonEmptyString, at: Schema.optionalKey(Schema.DateTimeUtcFromString) })

export type HorizonNightAsked = typeof HorizonNightAsked.Type

export const horizonPathsPath = '/horizon-paths'

export const targetSeparator = ','

const TargetList = Schema.String.pipe(Schema.decodeTo(Schema.Array(Schema.NonEmptyString), SchemaTransformation.transform<ReadonlyArray<string>, string>({ decode: text => text.split(targetSeparator), encode: ids => ids.join(targetSeparator) })))

export const HorizonPathsAsked = Schema.Struct({ targets: TargetList, at: Schema.optionalKey(Schema.DateTimeUtcFromString) })

export type HorizonPathsAsked = typeof HorizonPathsAsked.Type

export const Compass = Schema.Literals(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'])

export type Compass = typeof Compass.Type

export const SpellEdge = Schema.Union([
  Schema.Struct({ cause: Schema.Literal('dark') }),
  Schema.Struct({ cause: Schema.Literal('trees'), azimuthDegrees: Schema.Number, compass: Compass }),
  Schema.Struct({ cause: Schema.Literal('up-line'), azimuthDegrees: Schema.Number }),
  Schema.Struct({ cause: Schema.Literal('horizon'), azimuthDegrees: Schema.Number }),
])

export type SpellEdge = typeof SpellEdge.Type

export const ClearSpell = Schema.Struct({ from: Schema.Number, until: Schema.Number, startedBy: SpellEdge, endedBy: SpellEdge })

export type ClearSpell = typeof ClearSpell.Type

export const NightTimesAnswer = Schema.Struct({
  duskAt: Schema.Number,
  darkAt: Schema.NullOr(Schema.Number),
  darkEndsAt: Schema.NullOr(Schema.Number),
  dawnAt: Schema.Number,
})

export const TargetPath = Schema.Struct({
  startAt: Schema.Number,
  stepSeconds: Schema.Number,
  altitudes: Schema.Array(Schema.Number),
  azimuths: Schema.Array(Schema.Number),
  lines: Schema.Array(Schema.Number),
})

export type TargetPath = typeof TargetPath.Type

export const TimeSpan = Schema.Struct({ from: Schema.Number, until: Schema.Number })

export type TimeSpan = typeof TimeSpan.Type

export const MoonNight = Schema.Struct({
  litFraction: Schema.Number,
  altitudes: Schema.Array(Schema.Number),
  azimuths: Schema.Array(Schema.Number),
  upSpans: Schema.Array(TimeSpan),
})

export type MoonNight = typeof MoonNight.Type

export const FrameNight = Schema.Struct({
  angleDegrees: Schema.NullOr(Schema.Number),
  northAngles: Schema.Array(Schema.Number),
  firstCleanAt: Schema.NullOr(Schema.Number),
})

export type FrameNight = typeof FrameNight.Type

export const HorizonBins = Schema.Struct({
  fileLoaded: Schema.Boolean,
  altitudesDegrees: Schema.Array(Schema.NullOr(Schema.Number)),
  sources: Schema.Array(Schema.NullOr(HorizonSource)),
  sweepNights: Schema.Array(NightName),
  upLineDegrees: Schema.Number,
})

export const ClearFacts = Schema.Struct({
  which: Schema.Literals(['now', 'next']),
  clearsAt: Schema.Number,
  startedBy: SpellEdge,
  clearForSeconds: Schema.Number,
  endsAt: Schema.Number,
  endedBy: SpellEdge,
})

export const FlipFacts = Schema.Struct({
  at: Schema.Number,
  basis: Schema.Literals(['mount-limit', 'meridian']),
  limitDegrees: Schema.NullOr(Schema.Number),
})

export const NightFacts = Schema.Struct({
  clear: Schema.NullOr(ClearFacts),
  highest: Schema.Struct({ altitudeDegrees: Schema.Number, at: Schema.Number }),
  transitAt: Schema.NullOr(Schema.Number),
  flip: Schema.NullOr(FlipFacts),
})

export const HorizonNight = Schema.Struct({
  target: Schema.Struct({ id: TargetId, name: Schema.String, commonName: Schema.NullOr(Schema.String) }),
  at: Schema.Number,
  night: NightName,
  zone: Schema.String,
  times: NightTimesAnswer,
  horizon: HorizonBins,
  path: TargetPath,
  moon: MoonNight,
  frame: FrameNight,
  clear: Schema.Array(ClearSpell),
  facts: NightFacts,
})

export type HorizonNight = typeof HorizonNight.Type

export const HorizonPaths = Schema.Struct({
  at: Schema.Number,
  targets: Schema.Array(Schema.Struct({ target: Schema.Struct({ id: TargetId, name: Schema.String }), path: TargetPath })),
  unknown: Schema.Array(Schema.String),
})

export type HorizonPaths = typeof HorizonPaths.Type

export const HorizonRefusal = Schema.Union([
  Schema.Struct({ code: Schema.Literal('malformed') }),
  Schema.Struct({ code: Schema.Literal('unknown-target'), text: Schema.String }),
  Schema.Struct({ code: Schema.Literal('no-site') }),
  Schema.Struct({ code: Schema.Literal('no-night') }),
])

export type HorizonRefusal = typeof HorizonRefusal.Type
