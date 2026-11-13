import type { ReactNode } from 'react'

import type { CommandRequest } from '../../../state/commands.ts'
import { useCommand } from '../rig/use-command.ts'
import link from './ActionLink.module.css'
import styles from './CommandButton.module.css'
import { RefusalLine } from './RefusalLine.tsx'

interface CommandButtonProps {
  readonly request: CommandRequest
  readonly children: ReactNode
}

export function CommandButton({ request, children }: CommandButtonProps) {
  const { sending, refusal, press } = useCommand(request)

  return (
    <span className={styles.command}>
      <button type="button" className={sending ? `${link.link} ${styles.sending}` : link.link} disabled={sending} onClick={press}>
        {children}
      </button>

      {refusal === undefined ? null : <RefusalLine refusal={refusal} />}
    </span>
  )
}
