import { Match } from 'effect'
import { useState, type ReactNode } from 'react'

import type { CommandRequest, Refusal } from '../../../state/commands.ts'
import { sendCommand } from '../rig/commands.ts'
import styles from './CommandPill.module.css'
import pill from './PillLink.module.css'

interface CommandPillProps {
  readonly request: CommandRequest
  readonly waiting?: boolean
  readonly onCarriedOut?: () => void
  readonly children: ReactNode
}

const refusalWords = (refusal: Refusal) =>
  Match.valueTags(
    { ...refusal, _tag: refusal.code },
    {
      refused: ({ text }) => `Refused: ${text}`,
      malformed: () => 'Not understood',
      unreachable: () => 'No answer from Vela',
    },
  )

export function CommandPill({ request, waiting = false, onCarriedOut, children }: CommandPillProps) {
  const [sending, setSending] = useState(false)
  const [refusal, setRefusal] = useState<Refusal | undefined>(undefined)
  const busy = sending || waiting

  function press() {
    setSending(true)
    setRefusal(undefined)
    void sendCommand(request).then(answer => {
      setSending(false)
      setRefusal(answer)
      if (answer === undefined) onCarriedOut?.()
    })
  }

  return (
    <span className={styles.command}>
      <button type="button" className={busy ? `${pill.pill} ${pill.waiting}` : pill.pill} disabled={busy} onClick={press}>
        {children}
      </button>

      {refusal === undefined ? null : <span className={styles.refusal}>{refusalWords(refusal)}</span>}
    </span>
  )
}
