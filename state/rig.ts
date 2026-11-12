import type { RigEntry } from './entries.ts'
import type { StreamPosition } from './entry.ts'
import { frames, type Frame } from './frames.ts'
import { run, type Run } from './run.ts'

export interface RigState {
  readonly position: StreamPosition | undefined
  readonly run: Run | undefined
  readonly frames: ReadonlyArray<Frame>
}

export const emptyRig: RigState = { position: undefined, run: undefined, frames: [] }

export function rig(state: RigState, entry: RigEntry): RigState {
  return {
    position: entry.seq,
    run: run(state.run, entry),
    frames: frames(state.frames, entry),
  }
}
