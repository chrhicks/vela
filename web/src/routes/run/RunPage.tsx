import { useSearchParams } from 'react-router'

import { useLink, useRig } from '../../rig/store.ts'
import { CapturingView } from './CapturingView.tsx'
import { IdleView } from './IdleView.tsx'
import { ReadyView } from './picker/ReadyView.tsx'
import { liveCapturing } from './live.ts'
import { capturing } from './stub.ts'

export function RunPage() {
  const [search] = useSearchParams()
  const run = useRig(rig => rig.run)
  const frames = useRig(rig => rig.frames)
  const devices = useRig(rig => rig.devices)
  const guiding = useRig(rig => rig.guiding)
  const now = useLink().beat?.at
  const trends = useRig(rig => rig.trends)

  if (search.has('pick') || search.has('target')) return <ReadyView />
  if (run?.status === 'capturing') return <CapturingView run={liveCapturing({ run, frames, devices, guiding, now, trends }, capturing.steady)} />

  return <IdleView />
}
