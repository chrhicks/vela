import { useLocalNow } from '../../rig/clock.ts'
import { serviceNow } from '../../rig/service-clock.ts'
import { useLink, useRig } from '../../rig/store.ts'
import { useRigProgramUp } from '../../rig/use-rig-program-up.ts'
import { liveAreas } from './live.ts'

const secondsBetweenRedraws = 1

export function useAreas() {
  const rig = useRig(state => state)
  const rigUp = useRigProgramUp()
  const now = serviceNow(useLink(), useLocalNow(secondsBetweenRedraws * 1000))

  return liveAreas(rig, rigUp, now)
}
