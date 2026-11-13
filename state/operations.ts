import { Schema } from 'effect'
import { FilterAnswer } from './commands.ts'
import { RunEnding, RunId, type RigEntry } from './entries.ts'

const started = { run: RunId, startedAt: Schema.Number }

export const Running = Schema.Struct({ status: Schema.Literal('running'), ...started })

export const Ended = Schema.Struct({ status: Schema.Literal('ended'), ...started, endedAt: Schema.Number, ending: RunEnding, detail: Schema.optionalKey(Schema.String) })

export type Ended = typeof Ended.Type

export const Operation = Schema.Union([Running, Ended])

export type Operation = typeof Operation.Type

export const Operations = Schema.Struct({
  align: Schema.optional(Operation),
  focus: Schema.optional(Operation),
  filter: Schema.optional(FilterAnswer),
})

export type Operations = typeof Operations.Type

export const noOperations: Operations = {}

type RunEnd = Extract<RigEntry, { readonly kind: 'vela.run.ended' }>

const ended = (operation: Operation | undefined, end: RunEnd): Operation | undefined =>
  operation?.run === end.body.run && operation.status === 'running'
    ? { status: 'ended', run: operation.run, startedAt: operation.startedAt, endedAt: end.at, ending: end.body.reason, ...(end.body.detail === undefined ? {} : { detail: end.body.detail }) }
    : operation

export function operations(state: Operations, entry: RigEntry): Operations {
  switch (entry.kind) {
    case 'vela.align.started':
      return { ...state, align: { status: 'running', run: entry.body.run, startedAt: entry.at } }
    case 'vela.focus.started':
      return { ...state, focus: { status: 'running', run: entry.body.run, startedAt: entry.at } }
    case 'vela.filter':
      return { ...state, filter: entry.body.filter }
    case 'vela.run.ended': {
      const align = ended(state.align, entry)
      const focus = ended(state.focus, entry)

      return align === state.align && focus === state.focus ? state : { ...state, align, focus }
    }
    default:
      return state
  }
}

export const isRunning = (operation: Operation | undefined) => operation?.status === 'running'

const finished: ReadonlySet<RunEnding> = new Set(['done', 'stopped'])

export const cutShort = (operation: Operation | undefined): Ended | undefined => (operation?.status === 'ended' && !finished.has(operation.ending) ? operation : undefined)
