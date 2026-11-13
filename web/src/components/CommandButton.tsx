import type { ReactNode } from 'react'

import type { CommandRequest } from '../../../state/commands.ts'
import type { Answer } from '../rig/commands.ts'
import { useCommand } from '../rig/use-command.ts'
import link from './ActionLink.module.css'
import styles from './CommandButton.module.css'

interface CommandButtonProps {
  readonly request: CommandRequest
  readonly alwaysReady?: boolean
  readonly onAnswer: (answer: Answer) => void
  readonly children: ReactNode
}

export function CommandButton({ request, alwaysReady = false, onAnswer, children }: CommandButtonProps) {
  const { sending, press } = useCommand(request, onAnswer)
  const dimmed = sending && !alwaysReady

  return (
    <button type="button" className={dimmed ? `${link.link} ${styles.sending}` : link.link} disabled={dimmed} onClick={press}>
      {children}
    </button>
  )
}
