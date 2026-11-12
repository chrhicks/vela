import { Schema } from 'effect'
import { StreamPosition, type Entry } from './entry.ts'
import { RigState } from './rig.ts'

export const StartToken = Schema.String.pipe(Schema.brand('StartToken'))

export type StartToken = typeof StartToken.Type

export const feedPath = '/feed'

export const feedEvent = { state: 'state', entry: 'entry', heartbeat: 'heartbeat' } as const

export const LinkLimits = Schema.Struct({ heartbeatSeconds: Schema.Number, lostAfterSeconds: Schema.Number, rigSilentAfterSeconds: Schema.Number })

export type LinkLimits = typeof LinkLimits.Type

export const Bootstrap = Schema.Struct({ token: StartToken, at: Schema.Number, limits: LinkLimits, state: RigState })

export type Bootstrap = typeof Bootstrap.Type

export const Heartbeat = Schema.Struct({ at: Schema.Number })

export type Heartbeat = typeof Heartbeat.Type

export const FeedEntry = Schema.Struct({ seq: StreamPosition, kind: Schema.String, at: Schema.Number, body: Schema.optional(Schema.Unknown) })

export const entryOfFeed = ({ seq, kind, at, body }: typeof FeedEntry.Type): Entry => ({ seq, kind, at, body })
