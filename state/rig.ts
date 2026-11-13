import { Option, Result, Schema } from 'effect'
import { isGuiderReport, readRigEntry, type MalformedEntry, type RigEntry } from './entries.ts'
import { StreamPosition, type Entry } from './entry.ts'
import { Frame, frames } from './frames.ts'
import { Guiding, guiding, unknownGuiding } from './guiding.ts'
import { Readings, readings } from './readings.ts'
import { Devices, devices, noDevices } from './devices.ts'
import type { MalformedReading } from './entry.ts'
import { Run, run } from './run.ts'
import { noTrends, Trends, trends } from './trends.ts'
import { Alignment, alignment, noAlignment } from './alignment.ts'
import { Autofocus, autofocus, noAutofocus } from './autofocus.ts'
import { noOperations, Operations, operations } from './operations.ts'
import { Writes, writes } from './writes.ts'
import { CalibrationSet, calibration } from './calibration.ts'

export const RigState = Schema.Struct({
  position: Schema.optional(StreamPosition),
  run: Schema.optional(Run),
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
})

export type RigState = typeof RigState.Type

export const emptyRig: RigState = { position: undefined, run: undefined, frames: [], readings: {}, devices: noDevices, guiding: unknownGuiding, trends: noTrends, writes: {}, operations: noOperations, alignment: noAlignment, autofocus: noAutofocus, calibration: undefined }

const fromRig = (entry: RigEntry) => entry.kind === 'wire' || entry.kind === 'client.connected' || entry.kind === 'client.connection' || isGuiderReport(entry)

export function rig(state: RigState, entry: RigEntry): Result.Result<RigState, MalformedReading> {
  const nextReadings = readings(state.readings, entry)

  return devices(state.devices, state.readings, nextReadings, entry.seq).pipe(
    Result.map(nextDevices => ({
      position: entry.seq,
      run: run(state.run, entry),
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
