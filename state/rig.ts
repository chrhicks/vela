import type { Entry } from './entry.ts'
import { frames, type Frame } from './frames.ts'
import { run, type Run } from './run.ts'

export interface RigState {
  readonly position: number
  readonly run: Run | undefined
  readonly frames: ReadonlyArray<Frame>
}

export const emptyRig: RigState = { position: 0, run: undefined, frames: [] }

export function rig(state: RigState, entry: Entry): RigState {
  return {
    position: entry.seq,
    run: run(state.run, entry),
    frames: frames(state.frames, entry),
  }
}
