import type { FirstFramesBody } from '../../state/entries.ts'
import type { FirstFramesLimits } from '../../state/first-frames-check.ts'
import { firstFrames, seenIn } from '../../state/first-frames.ts'
import type { RigState } from '../../state/rig.ts'

export interface FirstFramesOptions {
  readonly limits: FirstFramesLimits
  readonly announce: (checked: FirstFramesBody) => void
}

export function makeFirstFramesCheck({ limits, announce }: FirstFramesOptions) {
  let announced: string | undefined

  return {
    observe(rig: RigState) {
      const run = rig.run

      if (run === undefined || run.id === announced || rig.firstFrames?.run === run.id) return

      const found = firstFrames(seenIn(rig), limits)

      if (found === undefined || found.stage === 'settling' || found.stage === 'checking') return

      announced = run.id
      announce({ run: run.id, verdict: found.stage, frames: found.checked, checks: found.checks })
    },
  }
}
