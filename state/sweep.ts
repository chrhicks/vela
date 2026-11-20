import { Schema } from 'effect'
import { SweepColumned, SweepFramed, SweepId, RehearsalEnding, type RigEntry } from './entries.ts'

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const Sweep = Schema.Struct({
  sweep: SweepId,
  columns: Count,
  exposureSeconds: Schema.Number,
  startedAt: Schema.Number,
  updatedAt: Schema.Number,
  frames: Count,
  last: Schema.optional(SweepFramed.fields.body),
  edges: Schema.Array(SweepColumned.fields.body),
  alerts: Count,
  alert: Schema.optional(Schema.String),
  ending: Schema.optional(RehearsalEnding),
  endedAt: Schema.optional(Schema.Number),
})

export type Sweep = typeof Sweep.Type

export function sweep(state: Sweep | undefined, entry: RigEntry): Sweep | undefined {
  switch (entry.kind) {
    case 'vela.sweep.run.started':
      return { sweep: entry.body.sweep, columns: entry.body.columns, exposureSeconds: entry.body.exposureSeconds, startedAt: entry.at, updatedAt: entry.at, frames: 0, edges: [], alerts: 0 }
    case 'vela.sweep.frame':
      return state?.sweep === entry.body.sweep ? { ...state, updatedAt: entry.at, frames: state.frames + 1, last: entry.body } : state
    case 'vela.sweep.column':
      return state?.sweep === entry.body.sweep ? { ...state, updatedAt: entry.at, edges: [...state.edges, entry.body] } : state
    case 'vela.sweep.alert':
      return state?.sweep === entry.body.sweep ? { ...state, updatedAt: entry.at, alerts: state.alerts + 1, alert: entry.body.text } : state
    case 'vela.sweep.run.ended':
      return state?.sweep === entry.body.sweep ? { ...state, ending: entry.body.ending, updatedAt: entry.at, endedAt: entry.at } : state
    case 'vela.started':
      return state === undefined || state.ending !== undefined ? state : { ...state, ending: 'restarted', updatedAt: entry.at, endedAt: entry.at }
    default:
      return state
  }
}

export const isSweeping = (state: Sweep | undefined) => state !== undefined && state.ending === undefined
