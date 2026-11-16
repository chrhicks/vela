import { useSearchParams } from 'react-router'

import { firstFrames, seenIn } from '../../../../state/first-frames.ts'
import { isStarting } from '../../../../state/starting.ts'
import { useLink, useRig } from '../../rig/store.ts'
import { CapturingView } from './CapturingView.tsx'
import { BetweenRunsView } from './BetweenRunsView.tsx'
import { ReadyView } from './picker/ReadyView.tsx'
import { liveCapturing } from './live.ts'
import { StartingView } from './StartingView.tsx'

export function RunPage() {
  const [search] = useSearchParams()
  const run = useRig(rig => rig.run)
  const frames = useRig(rig => rig.frames)
  const devices = useRig(rig => rig.devices)
  const guiding = useRig(rig => rig.guiding)
  const link = useLink()
  const now = link.beat?.at
  const trends = useRig(rig => rig.trends)
  const starting = useRig(rig => rig.starting)
  const autofocus = useRig(rig => rig.autofocus)
  const operations = useRig(rig => rig.operations)
  const announced = useRig(rig => rig.firstFrames)
  const stack = useRig(rig => rig.stack)

  if (starting !== undefined && isStarting(starting)) return <StartingView starting={starting} run={undefined} found={undefined} autofocus={autofocus} frames={frames} />
  if (search.has('pick') || search.has('target')) return <ReadyView />

  if (run?.status !== 'capturing') return <BetweenRunsView />

  const checked = announced?.run === run.id ? announced : undefined
  const found = link.firstFrames === undefined ? undefined : firstFrames(seenIn({ run, frames, autofocus, operations, devices, guiding, trends }), link.firstFrames)

  if (checked === undefined && found !== undefined && found.frames <= found.checked.to) {
    return <StartingView starting={starting?.target.id === run.target?.id ? starting : undefined} run={run} found={found} autofocus={autofocus} frames={frames} />
  }

  return <CapturingView run={liveCapturing({ run, frames, devices, guiding, now, trends, checked, stack, night: link.night, starting: starting?.target.id === run.target?.id ? starting : undefined })} />
}
