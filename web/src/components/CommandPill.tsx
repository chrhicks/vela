import type { ReactNode } from 'react'

import type { CommandRequest } from '../../../state/commands.ts'
import { useCommand } from '../rig/use-command.ts'
import styles from './CommandPill.module.css'
import pill from './PillLink.module.css'
import { RefusalLine } from './RefusalLine.tsx'

interface CommandPillProps {
  readonly request: CommandRequest
  readonly waiting?: boolean
  readonly onCarriedOut?: () => void
  readonly children: ReactNode
}

export function CommandPill({ request, waiting = false, onCarriedOut, children }: CommandPillProps) {
  const { sending, answer, press } = useCommand(request, received => (received.result === 'done' ? onCarriedOut?.() : undefined))
  const busy = sending || waiting

  return (
    <span className={styles.command}>
      <button type="button" className={busy ? `${pill.pill} ${pill.waiting}` : pill.pill} disabled={busy} onClick={press}>
        {children}
      </button>

      {answer?.result === 'refused' ? <RefusalLine refusal={answer.refusal} /> : null}
    </span>
  )
}
