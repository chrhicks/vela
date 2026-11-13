import { Schema } from 'effect'
import { DeviceName } from './devices.ts'

export const commandsPath = '/commands'

export const FilterAnswer = Schema.Literals(['in', 'out'])

export type FilterAnswer = typeof FilterAnswer.Type

export const NudgeDirection = Schema.Literals(['north', 'south', 'east', 'west'])

export type NudgeDirection = typeof NudgeDirection.Type

export const NudgeRate = Schema.Literals(['slow', 'fast'])

export type NudgeRate = typeof NudgeRate.Type

export const NudgeId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)).pipe(Schema.brand('NudgeId'))

export type NudgeId = typeof NudgeId.Type

export const CommandRequest = Schema.Union([
  Schema.Struct({ command: Schema.Literal('startAlignment') }),
  Schema.Struct({ command: Schema.Literal('finishAlignment') }),
  Schema.Struct({ command: Schema.Literal('answerFilter'), filter: FilterAnswer }),
  Schema.Struct({ command: Schema.Literal('home') }),
  Schema.Struct({ command: Schema.Literal('stop') }),
  Schema.Struct({ command: Schema.Literal('tracking'), on: Schema.Boolean }),
  Schema.Struct({ command: Schema.Literal('nudge'), id: NudgeId, direction: NudgeDirection, rate: NudgeRate }),
  Schema.Struct({ command: Schema.Literal('holdNudge'), id: NudgeId }),
  Schema.Struct({ command: Schema.Literal('releaseNudge'), id: NudgeId }),
  Schema.Struct({ command: Schema.Literal('slewAndCentre'), target: Schema.NonEmptyString }),
  Schema.Struct({ command: Schema.Literal('flipNow') }),
])

export type CommandRequest = typeof CommandRequest.Type

export const Done = Schema.Union([
  Schema.Struct({ code: Schema.Literal('carried-out') }),
  Schema.Struct({ code: Schema.Literal('home'), endedRun: Schema.Boolean }),
  Schema.Struct({ code: Schema.Literal('stop'), endedRun: Schema.Boolean }),
  Schema.Struct({ code: Schema.Literal('tracking'), on: Schema.Boolean }),
  Schema.Struct({ code: Schema.Literal('centring'), target: Schema.String, endedRun: Schema.Boolean }),
  Schema.Struct({ code: Schema.Literal('flip-sent') }),
])

export type Done = typeof Done.Type

export const Refusal = Schema.Union([
  Schema.Struct({ code: Schema.Literal('refused'), text: Schema.String }),
  Schema.Struct({ code: Schema.Literal('not-connected'), device: DeviceName }),
  Schema.Struct({ code: Schema.Literal('no-answer'), seconds: Schema.Number }),
  Schema.Struct({ code: Schema.Literal('rig-refused'), text: Schema.String }),
  Schema.Struct({ code: Schema.Literal('unknown-target'), text: Schema.String }),
  Schema.Struct({ code: Schema.Literal('malformed') }),
  Schema.Struct({ code: Schema.Literal('unreachable') }),
])

export type Refusal = typeof Refusal.Type
