import { Match } from 'effect'

import { useLocalNow } from '../rig/clock.ts'
import { linkProblem } from '../rig/link.ts'
import { useLink, useRig } from '../rig/store.ts'
import { ActionLink } from './ActionLink.tsx'
import { Alert } from './Alert.tsx'

const secondsBetweenRedraws = 1

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

export function LinkAlert() {
  const link = useLink()
  const run = useRig(rig => rig.run)
  const heardAt = useRig(rig => rig.heardAt)
  const now = useLocalNow(secondsBetweenRedraws * 1000)
  const problem = linkProblem(link, run, heardAt, now)

  if (problem === undefined) return null

  return Match.valueTags(problem, {
    NoConnection: ({ since }) => <Alert title={`No connection ${clock(since)}`} facts={['Cause: no word from Vela', 'Tried: reconnecting', 'Rig keeps running']} />,
    RigSilent: ({ since }) => (
      <Alert title={`Rig silent ${clock(since)}`} facts={['Cause: no word from the rig program', 'Tried: waiting']}>
        <ActionLink to="/controls/system">Open system controls</ActionLink>
      </Alert>
    ),
  })
}
