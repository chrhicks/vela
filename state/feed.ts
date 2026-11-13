import { Schema } from 'effect'
import { NightName } from './entries.ts'
import { StreamPosition, type Entry } from './entry.ts'
import { RigState } from './rig.ts'

export const StartToken = Schema.String.pipe(Schema.brand('StartToken'))

export type StartToken = typeof StartToken.Type

export const feedPath = '/feed'

export const FeedEventName = Schema.Literals(['state', 'entry', 'heartbeat'])

export type FeedEventName = typeof FeedEventName.Type

export const LinkLimits = Schema.Struct({ heartbeatSeconds: Schema.Number, lostAfterSeconds: Schema.Number, rigSilentAfterSeconds: Schema.Number })

export type LinkLimits = typeof LinkLimits.Type

export const LaunchLimits = Schema.Struct({ alignGoodArcmin: Schema.Number, alignMovedArcmin: Schema.Number })

export type LaunchLimits = typeof LaunchLimits.Type

export const ControlsLimits = Schema.Struct({ nudgeHoldMs: Schema.Number, focusSteps: Schema.Array(Schema.Int), autofocusExposureSeconds: Schema.Struct({ in: Schema.Number, out: Schema.Number }), coolerCelsius: Schema.Number, testFrameSeconds: Schema.Number, calibrationFrames: Schema.Int })

export type ControlsLimits = typeof ControlsLimits.Type

export const Bootstrap = Schema.Struct({ token: StartToken, at: Schema.Number, night: NightName, limits: LinkLimits, launch: LaunchLimits, controls: ControlsLimits, state: RigState })

export type Bootstrap = typeof Bootstrap.Type

export const Heartbeat = Schema.Struct({ at: Schema.Number, night: NightName })

export type Heartbeat = typeof Heartbeat.Type

export const FeedEntry = Schema.Struct({ seq: StreamPosition, kind: Schema.String, at: Schema.Number, body: Schema.optional(Schema.Unknown) })

export const entryOfFeed = ({ seq, kind, at, body }: typeof FeedEntry.Type): Entry => ({ seq, kind, at, body })
