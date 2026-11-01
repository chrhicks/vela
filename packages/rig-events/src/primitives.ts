import { Schema } from 'effect'
import { ImageId } from './wire.ts'

export const EpochMs = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)), Schema.brand('EpochMs'))

export type EpochMs = typeof EpochMs.Type

export const RigId = Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,62}$/)), Schema.brand('RigId'))

export type RigId = typeof RigId.Type

export const SourceId = Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-z0-9][a-z0-9:._-]{0,127}$/)), Schema.brand('SourceId'))

export type SourceId = typeof SourceId.Type

export const EventId = Schema.String.pipe(Schema.check(Schema.isPattern(/^\S{1,256}$/)), Schema.brand('EventId'))

export type EventId = typeof EventId.Type

export const SkyPosition = Schema.Struct({ raDegrees: Schema.Number, decDegrees: Schema.Number })

export type SkyPosition = typeof SkyPosition.Type

export const epochMs = Schema.decodeSync(EpochMs)

export const rigId = Schema.decodeSync(RigId)

export const sourceId = Schema.decodeSync(SourceId)

export const eventId = Schema.decodeSync(EventId)

export const imageId = Schema.decodeSync(ImageId)
