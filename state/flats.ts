import { Schema } from 'effect'
import { FlatVerdict, type RigEntry } from './entries.ts'

export const FlatExposure = Schema.Struct({ exposureSeconds: Schema.Number, sky: Schema.optionalKey(Schema.Number), verdict: FlatVerdict, nextSeconds: Schema.optionalKey(Schema.Number), at: Schema.Number })

export type FlatExposure = typeof FlatExposure.Type

export function flatExposure(state: FlatExposure | undefined, entry: RigEntry): FlatExposure | undefined {
  if (entry.kind === 'vela.flats.exposure') return { ...entry.body, at: entry.at }

  return entry.kind === 'vela.started' && state?.verdict === 'trying' ? { ...state, verdict: 'stopped', at: entry.at } : state
}
