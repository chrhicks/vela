import { Option, Result, Schema } from 'effect'
import { readRigEntry, type MalformedEntry, type RigEntry } from './entries.ts'
import { StreamPosition, type Entry } from './entry.ts'
import { Frame, frames } from './frames.ts'
import { Readings, readings } from './readings.ts'
import { Run, run } from './run.ts'

export const RigState = Schema.Struct({
  position: Schema.optional(StreamPosition),
  run: Schema.optional(Run),
  frames: Schema.Array(Frame),
  readings: Readings,
})

export type RigState = typeof RigState.Type

export const emptyRig: RigState = { position: undefined, run: undefined, frames: [], readings: {} }

export function rig(state: RigState, entry: RigEntry): RigState {
  return {
    position: entry.seq,
    run: run(state.run, entry),
    frames: frames(state.frames, entry),
    readings: readings(state.readings, entry),
  }
}

export function advance(state: RigState, entry: Entry): Result.Result<RigState, MalformedEntry> {
  return readRigEntry(entry).pipe(
    Result.map(
      Option.match({
        onNone: () => ({ ...state, position: entry.seq }),
        onSome: rigEntry => rig(state, rigEntry),
      }),
    ),
  )
}
