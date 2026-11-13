import { Option, Result, Schema } from 'effect'
import { readRigEntry, type MalformedEntry, type RigEntry } from './entries.ts'
import { StreamPosition, type Entry } from './entry.ts'
import { Frame, frames } from './frames.ts'
import { Guiding, guiding, unknownGuiding } from './guiding.ts'
import { Readings, readings } from './readings.ts'
import { Run, run } from './run.ts'
import { noTrends, Trends, trends } from './trends.ts'
import { Writes, writes } from './writes.ts'

export const RigState = Schema.Struct({
  position: Schema.optional(StreamPosition),
  run: Schema.optional(Run),
  frames: Schema.Array(Frame),
  readings: Readings,
  guiding: Guiding,
  trends: Trends,
  heardAt: Schema.optional(Schema.Number),
  writes: Writes,
})

export type RigState = typeof RigState.Type

export const emptyRig: RigState = { position: undefined, run: undefined, frames: [], readings: {}, guiding: unknownGuiding, trends: noTrends, writes: {} }

const fromRig = (entry: RigEntry) => entry.kind === 'wire' || entry.kind === 'client.connected' || entry.kind === 'client.connection' || entry.kind.startsWith('phd2.')

export function rig(state: RigState, entry: RigEntry): RigState {
  return {
    position: entry.seq,
    run: run(state.run, entry),
    frames: frames(state.frames, entry),
    readings: readings(state.readings, entry),
    guiding: guiding(state.guiding, entry),
    trends: trends(state.trends, entry),
    heardAt: fromRig(entry) ? entry.at : state.heardAt,
    writes: writes(state.writes, entry),
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
