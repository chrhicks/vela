import type { ReactNode } from 'react'

import type { RunEnding } from '../../../../state/entries.ts'
import type { Ended } from '../../../../state/operations.ts'
import { Alert } from '../../components/Alert.tsx'
import { clockTime } from '../../rig/clock.ts'

const endingWords: Readonly<Record<RunEnding, string>> = {
  done: 'finished',
  stopped: 'stopped',
  failures: 'exposures kept failing',
  refused: 'Vela refused it',
  interrupted: 'Vela restarted',
  unknown: 'not known',
}

interface StoppedAlertProps {
  readonly what: string
  readonly ended: Ended
  readonly children?: ReactNode
}

export function StoppedAlert({ what, ended, children }: StoppedAlertProps) {
  return (
    <Alert title={`${what} stopped ${clockTime(ended.endedAt)}`} facts={[`Cause: ${ended.detail ?? endingWords[ended.ending]}`]}>
      {children}
    </Alert>
  )
}
