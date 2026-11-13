import { Schema } from 'effect'
import { isOperationObject, RunId, type RigEntry } from './entries.ts'

export const calibrationTypes = ['dark', 'flat', 'bias'] as const

export const CalibrationType = Schema.Literals(calibrationTypes)

export type CalibrationType = typeof CalibrationType.Type

export const CalibrationSet = Schema.Struct({ run: RunId, frameType: CalibrationType, exposureSeconds: Schema.Number, frames: Schema.Number, startedAt: Schema.Number })

export type CalibrationSet = typeof CalibrationSet.Type

const isCalibrationType = (frameType: string): frameType is CalibrationType => calibrationTypes.some(type => type === frameType)

export function calibration(state: CalibrationSet | undefined, entry: RigEntry): CalibrationSet | undefined {
  if (entry.kind === 'vela.run.started') {
    const { run, object, frameType, exposureSeconds } = entry.body

    return isCalibrationType(frameType) && !isOperationObject(object) ? { run, frameType, exposureSeconds, frames: 0, startedAt: entry.at } : state
  }

  if (entry.kind === 'vela.run.exposed' && entry.body.run === state?.run) return { ...state, frames: state.frames + 1 }

  return state
}
