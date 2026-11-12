import { Match } from 'effect'

import { Alert } from '../components/Alert.tsx'
import { useLocalNow } from '../rig/clock.ts'
import { linkProblem } from '../rig/link.ts'
import { useLink, useRig } from '../rig/store.ts'
import styles from './LinkAlert.module.css'

const secondsBetweenRedraws = 1

function elapsed(seconds: number): string {
  const whole = Math.floor(seconds)

  if (whole < 60) return `${whole} s`
  if (whole < 3600) return `${Math.floor(whole / 60)} min`

  return `${Math.floor(whole / 3600)} h ${String(Math.floor((whole % 3600) / 60)).padStart(2, '0')}`
}

export function LinkAlert() {
  const link = useLink()
  const run = useRig(rig => rig.run)
  const heardAt = useRig(rig => rig.heardAt)
  const now = useLocalNow(secondsBetweenRedraws * 1000)
  const problem = linkProblem(link, run, heardAt, now)

  if (problem === undefined) return null

  const shown = Match.valueTags(problem, {
    NoConnection: ({ seconds }) => ({ title: 'No connection', facts: [elapsed(seconds), 'Reconnecting'] }),
    RigSilent: ({ seconds }) => ({ title: 'Rig silent', facts: [elapsed(seconds), 'Check rig PC'] }),
  })

  return (
    <div className={styles.placement}>
      <Alert title={shown.title} facts={shown.facts} />
    </div>
  )
}
