import { rigProgramUp } from '../../../state/bring-up.ts'
import { useLocalNow } from './clock.ts'
import { serviceNow } from './service-clock.ts'
import { useLink, useRig } from './store.ts'

const secondsBetweenChecks = 1

export function useRigProgramUp(): boolean {
  const link = useLink()
  const heardAt = useRig(rig => rig.heardAt)
  const now = useLocalNow(secondsBetweenChecks * 1000)

  return rigProgramUp({ heardAt }, serviceNow(link, now), link.limits?.rigSilentAfterSeconds)
}
