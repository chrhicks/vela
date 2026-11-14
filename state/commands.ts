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
  Schema.Struct({ command: Schema.Literal('focusTo'), position: Schema.Int }),
  Schema.Struct({ command: Schema.Literal('focusBy'), steps: Schema.Int }),
  Schema.Struct({ command: Schema.Literal('coolTo'), celsius: Schema.Number }),
  Schema.Struct({ command: Schema.Literal('coolerOff') }),
  Schema.Struct({ command: Schema.Literal('dewAuto') }),
  Schema.Struct({ command: Schema.Literal('dewFixed'), percent: Schema.Number }),
  Schema.Struct({ command: Schema.Literal('dewOff') }),
  Schema.Struct({ command: Schema.Literal('takeDarks'), frames: Schema.Int.check(Schema.isGreaterThan(0)), exposureSeconds: Schema.Number.check(Schema.isGreaterThan(0)), celsius: Schema.Number }),
  Schema.Struct({ command: Schema.Literal('takeDarkFlats'), frames: Schema.Int.check(Schema.isGreaterThan(0)), exposureSeconds: Schema.Number.check(Schema.isGreaterThan(0)), celsius: Schema.Number }),
  Schema.Struct({ command: Schema.Literal('takeBias'), frames: Schema.Int.check(Schema.isGreaterThan(0)), celsius: Schema.Number }),
  Schema.Struct({ command: Schema.Literal('testFrame'), exposureSeconds: Schema.Number.check(Schema.isGreaterThan(0)) }),
  Schema.Struct({ command: Schema.Literal('autofocus'), exposureSeconds: Schema.Number.check(Schema.isGreaterThan(0)) }),
])

export type CommandRequest = typeof CommandRequest.Type

export const Done = Schema.Union([
  Schema.Struct({ code: Schema.Literal('carried-out') }),
  Schema.Struct({ code: Schema.Literal('focusing'), position: Schema.Number }),
  Schema.Struct({ code: Schema.Literal('focused'), position: Schema.Number }),
  Schema.Struct({ code: Schema.Literal('cooling'), celsius: Schema.Number }),
  Schema.Struct({ code: Schema.Literal('cooler-off') }),
  Schema.Struct({ code: Schema.Literal('dew-auto') }),
  Schema.Struct({ code: Schema.Literal('dew-fixed'), percent: Schema.Number }),
  Schema.Struct({ code: Schema.Literal('dew-off') }),
  Schema.Struct({ code: Schema.Literal('darks'), frames: Schema.Number, exposureSeconds: Schema.Number, celsius: Schema.Number }),
  Schema.Struct({ code: Schema.Literal('dark-flats'), frames: Schema.Number, exposureSeconds: Schema.Number, celsius: Schema.Number }),
  Schema.Struct({ code: Schema.Literal('bias'), frames: Schema.Number, celsius: Schema.Number }),
  Schema.Struct({ code: Schema.Literal('test-frame'), exposureSeconds: Schema.Number, sequence: Schema.String }),
  Schema.Struct({ code: Schema.Literal('autofocusing'), exposureSeconds: Schema.Number, endedRun: Schema.Boolean }),
  Schema.Struct({ code: Schema.Literal('home'), endedRun: Schema.Boolean }),
  Schema.Struct({ code: Schema.Literal('stop'), endedRun: Schema.Boolean }),
  Schema.Struct({ code: Schema.Literal('tracking'), on: Schema.Boolean }),
  Schema.Struct({ code: Schema.Literal('centring'), target: Schema.String, endedRun: Schema.Boolean }),
  Schema.Struct({ code: Schema.Literal('flip'), settled: Schema.Boolean, flipped: Schema.Boolean, pierSide: Schema.optionalKey(Schema.Literals(['east', 'west'])), pausedRun: Schema.Boolean }),
])

export type Done = typeof Done.Type

export const Refusal = Schema.Union([
  Schema.Struct({ code: Schema.Literal('refused'), text: Schema.String }),
  Schema.Struct({ code: Schema.Literal('not-connected'), device: DeviceName }),
  Schema.Struct({ code: Schema.Literal('no-answer'), seconds: Schema.Number }),
  Schema.Struct({ code: Schema.Literal('rig-refused'), text: Schema.String }),
  Schema.Struct({ code: Schema.Literal('unknown-target'), text: Schema.String }),
  Schema.Struct({ code: Schema.Literal('move-failed'), device: DeviceName }),
  Schema.Struct({ code: Schema.Literal('run-active') }),
  Schema.Struct({ code: Schema.Literal('out-of-range'), value: Schema.Number, min: Schema.Number, max: Schema.Number }),
  Schema.Struct({ code: Schema.Literal('malformed') }),
  Schema.Struct({ code: Schema.Literal('unreachable') }),
])

export type Refusal = typeof Refusal.Type
