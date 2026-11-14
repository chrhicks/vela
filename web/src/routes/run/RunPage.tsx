import { useSearchParams } from 'react-router'

import { isStarting } from '../../../../state/starting.ts'
import { useLink, useRig } from '../../rig/store.ts'
import { CapturingView } from './CapturingView.tsx'
import { IdleView } from './IdleView.tsx'
import { ReadyView } from './picker/ReadyView.tsx'
import { liveCapturing } from './live.ts'
import { StartView } from './StartView.tsx'
import { capturing } from './stub.ts'

export function RunPage() {
  const [search] = useSearchParams()
  const run = useRig(rig => rig.run)
  const frames = useRig(rig => rig.frames)
  const devices = useRig(rig => rig.devices)
  const guiding = useRig(rig => rig.guiding)
  const now = useLink().beat?.at
  const trends = useRig(rig => rig.trends)
  const starting = useRig(rig => rig.starting)

  if (search.has('pick') || search.has('target')) return <ReadyView />
  if (starting !== undefined && isStarting(starting)) return <StartView starting={starting} />
  if (run?.status === 'capturing') return <CapturingView run={liveCapturing({ run, frames, devices, guiding, now, trends }, capturing.steady)} />

  return <IdleView />
}
