import { Schema } from 'effect'
import { RunId, type RigEntry } from './entries.ts'

export const CalibrationType = Schema.Literals(['dark', 'flat', 'bias'])

export type CalibrationType = typeof CalibrationType.Type

export const CalibrationSet = Schema.Struct({ run: RunId, frameType: CalibrationType, exposureSeconds: Schema.Number, frames: Schema.Number, startedAt: Schema.Number })

export type CalibrationSet = typeof CalibrationSet.Type

export function calibration(state: CalibrationSet | undefined, entry: RigEntry): CalibrationSet | undefined {
  if (entry.kind === 'vela.run.started') {
    const { run, object, frameType, exposureSeconds } = entry.body

    return frameType !== 'light' && object._tag === 'Target' ? { run, frameType, exposureSeconds, frames: 0, startedAt: entry.at } : state
  }

  if (entry.kind === 'vela.run.exposed' && entry.body.run === state?.run) return { ...state, frames: state.frames + 1 }

  return state
}
