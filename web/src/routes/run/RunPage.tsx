import { useSearchParams } from 'react-router'

import { useRig } from '../../rig/store.ts'
import { useScene } from '../../stub/useScene.ts'
import { CapturingView } from './CapturingView.tsx'
import { IdleView } from './IdleView.tsx'
import { NightOverView } from './NightOverView.tsx'
import { ReadyView } from './picker/ReadyView.tsx'
import { StartingView } from './StartingView.tsx'
import { liveCapturing } from './live.ts'
import { capturing } from './stub.ts'

export function RunPage() {
  const [search] = useSearchParams()
  const run = useRig(rig => rig.run)
  const frames = useRig(rig => rig.frames)
  const readings = useRig(rig => rig.readings)
  const guiding = useRig(rig => rig.guiding)
  const asked = useScene(['idle', 'ready', 'starting', 'capturing', 'alert', 'over'])
  const scene = !search.has('scene') && run?.status === 'capturing' ? 'capturing' : asked

  switch (scene) {
    case 'idle':
      return <IdleView />
    case 'ready':
      return <ReadyView />
    case 'starting':
      return <StartingView />
    case 'capturing':
      return <CapturingView run={liveCapturing({ run, frames, readings, guiding }, capturing.steady)} />
    case 'alert':
      return <CapturingView run={capturing.alert} />
    case 'over':
      return <NightOverView />
  }
}
