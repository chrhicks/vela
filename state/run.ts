import { Schema } from 'effect'
import { isOperationObject, RunEnding, RunId, type RigEntry } from './entries.ts'

const runFacts = {
  id: RunId,
  object: Schema.String,
  frameType: Schema.String,
  exposureSeconds: Schema.Number,
  count: Schema.optional(Schema.Number),
  startedAt: Schema.Number,
  frames: Schema.Number,
  failures: Schema.Number,
}

export const Run = Schema.Union([
  Schema.Struct({ status: Schema.Literal('capturing'), ...runFacts }),
  Schema.Struct({ status: Schema.Literal('ended'), ...runFacts, endedAt: Schema.Number, reason: RunEnding }),
])

export type Run = typeof Run.Type

export function run(state: Run | undefined, entry: RigEntry): Run | undefined {
  if (entry.kind === 'vela.run.started') {
    if (isOperationObject(entry.body.object)) return state

    const { run: id, object, frameType, exposureSeconds, count } = entry.body

    return { status: 'capturing', id, object, frameType, exposureSeconds, count, startedAt: entry.at, frames: 0, failures: 0 }
  }

  if (state?.status !== 'capturing') return state

  switch (entry.kind) {
    case 'vela.run.exposed':
      return entry.body.run === state.id ? { ...state, frames: entry.body.frame } : state
    case 'vela.run.failed':
      return entry.body.run === state.id ? { ...state, failures: state.failures + 1 } : state
    case 'vela.run.ended':
      return entry.body.run === state.id ? { ...state, status: 'ended', endedAt: entry.at, reason: entry.body.reason } : state
    default:
      return state
  }
}
