import { Schema } from 'effect'
import { FilterAnswer } from './commands.ts'
import { RunId, type RigEntry } from './entries.ts'

export const Operation = Schema.Struct({ run: RunId, startedAt: Schema.Number, status: Schema.Literals(['running', 'ended']) })

export type Operation = typeof Operation.Type

export const Operations = Schema.Struct({
  align: Schema.optional(Operation),
  focus: Schema.optional(Operation),
  filter: Schema.optional(FilterAnswer),
})

export type Operations = typeof Operations.Type

export const noOperations: Operations = {}

const ended = (operation: Operation | undefined, run: RunId): Operation | undefined => (operation?.run === run && operation.status === 'running' ? { ...operation, status: 'ended' } : operation)

export function operations(state: Operations, entry: RigEntry): Operations {
  switch (entry.kind) {
    case 'vela.align.started':
      return { ...state, align: { run: entry.body.run, startedAt: entry.at, status: 'running' } }
    case 'vela.focus.started':
      return { ...state, focus: { run: entry.body.run, startedAt: entry.at, status: 'running' } }
    case 'vela.filter':
      return { ...state, filter: entry.body.filter }
    case 'vela.run.ended': {
      const align = ended(state.align, entry.body.run)
      const focus = ended(state.focus, entry.body.run)

      return align === state.align && focus === state.focus ? state : { ...state, align, focus }
    }
    default:
      return state
  }
}

export const isRunning = (operation: Operation | undefined) => operation?.status === 'running'
