import { Schema } from 'effect'
import { FlatVerdict, type RigEntry } from './entries.ts'

export const FlatExposure = Schema.Struct({ exposureSeconds: Schema.Number, sky: Schema.optionalKey(Schema.Number), verdict: FlatVerdict, nextSeconds: Schema.optionalKey(Schema.Number), at: Schema.Number })

export type FlatExposure = typeof FlatExposure.Type

export const flatExposure = (state: FlatExposure | undefined, entry: RigEntry): FlatExposure | undefined => (entry.kind === 'vela.flats.exposure' ? { ...entry.body, at: entry.at } : state)
