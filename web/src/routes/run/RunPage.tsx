import { useScene } from '../../stub/useScene.ts'
import { CapturingView } from './CapturingView.tsx'
import { IdleView } from './IdleView.tsx'
import { NightOverView } from './NightOverView.tsx'
import { StartingView } from './StartingView.tsx'
import { capturing } from './stub.ts'

export function RunPage() {
  const scene = useScene(['idle', 'starting', 'capturing', 'alert', 'over'])

  switch (scene) {
    case 'idle':
      return <IdleView />
    case 'starting':
      return <StartingView />
    case 'capturing':
      return <CapturingView run={capturing.steady} />
    case 'alert':
      return <CapturingView run={capturing.alert} />
    case 'over':
      return <NightOverView />
  }
}
