import { Schema } from 'effect'

export const commandsPath = '/commands'

export const FilterAnswer = Schema.Literals(['in', 'out'])

export type FilterAnswer = typeof FilterAnswer.Type

export const NudgeDirection = Schema.Literals(['N', 'S', 'E', 'W'])

export type NudgeDirection = typeof NudgeDirection.Type

export const CommandRequest = Schema.Union([
  Schema.Struct({ command: Schema.Literal('startAlignment') }),
  Schema.Struct({ command: Schema.Literal('finishAlignment') }),
  Schema.Struct({ command: Schema.Literal('answerFilter'), filter: FilterAnswer }),
])

export type CommandRequest = typeof CommandRequest.Type

export const Refusal = Schema.Union([
  Schema.Struct({ code: Schema.Literal('refused'), text: Schema.String }),
  Schema.Struct({ code: Schema.Literal('malformed') }),
  Schema.Struct({ code: Schema.Literal('unreachable') }),
])

export type Refusal = typeof Refusal.Type
