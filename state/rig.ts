import { Option, Result, Schema } from 'effect'
import { isGuiderReport, readRigEntry, type MalformedEntry, type RigEntry } from './entries.ts'
import { StreamPosition, type Entry } from './entry.ts'
import { Frame, frames } from './frames.ts'
import { Guiding, guiding, unknownGuiding } from './guiding.ts'
import { Readings, readings } from './readings.ts'
import { Devices, devices, noDevices } from './devices.ts'
import type { MalformedReading } from './entry.ts'
import { Run, run } from './run.ts'
import { Rehearsal, rehearsal } from './rehearsal.ts'
import { Sweep, sweep } from './sweep.ts'
import { Starting, starting } from './starting.ts'
import { FirstFramesChecked, firstFramesChecked } from './first-frames.ts'
import { noTrends, Trends, trends } from './trends.ts'
import { Alignment, alignment, noAlignment } from './alignment.ts'
import { Autofocus, autofocus, noAutofocus } from './autofocus.ts'
import { noOperations, Operations, operations } from './operations.ts'
import { Writes, writes } from './writes.ts'
import { CalibrationSet, calibration } from './calibration.ts'
import { FlatExposure, flatExposure } from './flats.ts'
import { nothingPressed, Pressing, pressing } from './pressing.ts'
import { Stacked, stacked } from './stack.ts'
import { noReviews, Reviews, reviews } from './review.ts'

export const RigState = Schema.Struct({
  position: Schema.optional(StreamPosition),
  run: Schema.optional(Run),
  starting: Schema.optional(Starting),
  rehearsal: Schema.optional(Rehearsal),
  sweep: Schema.optional(Sweep),
  firstFrames: Schema.optional(FirstFramesChecked),
  frames: Schema.Array(Frame),
  readings: Readings,
  devices: Devices,
  guiding: Guiding,
  trends: Trends,
  heardAt: Schema.optional(Schema.Number),
  connectedAt: Schema.optional(Schema.Number),
  writes: Writes,
  operations: Operations,
  alignment: Alignment,
  autofocus: Autofocus,
  calibration: Schema.optional(CalibrationSet),
  flatExposure: Schema.optional(FlatExposure),
  stack: Schema.optional(Stacked),
  reviews: Reviews,
  pressing: Pressing,
})

export type RigState = typeof RigState.Type

export const emptyRig: RigState = { position: undefined, run: undefined, starting: undefined, rehearsal: undefined, sweep: undefined, firstFrames: undefined, frames: [], readings: {}, devices: noDevices, guiding: unknownGuiding, trends: noTrends, writes: {}, operations: noOperations, alignment: noAlignment, autofocus: noAutofocus, calibration: undefined, flatExposure: undefined, stack: undefined, reviews: noReviews, pressing: nothingPressed }

const fromRig = (entry: RigEntry) => entry.kind === 'wire' || entry.kind === 'client.connected' || entry.kind === 'client.connection' || isGuiderReport(entry)

export function rig(state: RigState, entry: RigEntry): Result.Result<RigState, MalformedReading> {
  const nextReadings = readings(state.readings, entry)

  return devices(state.devices, state.readings, nextReadings, entry.seq).pipe(
    Result.map(nextDevices => ({
      position: entry.seq,
      run: run(state.run, entry),
      starting: starting(state.starting, entry),
      rehearsal: rehearsal(state.rehearsal, entry),
      sweep: sweep(state.sweep, entry),
      firstFrames: firstFramesChecked(state.firstFrames, entry),
      frames: frames(state.frames, entry),
      readings: nextReadings,
      devices: nextDevices,
      guiding: guiding(state.guiding, entry),
      trends: trends(state.trends, entry, nextDevices),
      heardAt: fromRig(entry) ? entry.at : state.heardAt,
      connectedAt: entry.kind === 'client.connected' ? entry.at : state.connectedAt,
      writes: writes(state.writes, entry),
      operations: operations(state.operations, entry),
      alignment: alignment(state.alignment, entry),
      autofocus: autofocus(state.autofocus, entry),
      calibration: calibration(state.calibration, entry),
      flatExposure: flatExposure(state.flatExposure, entry),
      stack: stacked(state.stack, entry),
      reviews: reviews(state.reviews, entry),
      pressing: pressing(state.pressing, entry),
    })),
  )
}

export function advance(state: RigState, entry: Entry): Result.Result<RigState, MalformedEntry | MalformedReading> {
  return readRigEntry(entry).pipe(
    Result.flatMap(
      Option.match({
        onNone: () => Result.succeed({ ...state, position: entry.seq }),
        onSome: rigEntry => rig(state, rigEntry),
      }),
    ),
  )
}
