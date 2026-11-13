import { useState } from 'react'

import type { CommandRequest, Refusal } from '../../../state/commands.ts'
import { sendCommand } from './commands.ts'

export interface Command {
  readonly sending: boolean
  readonly refusal: Refusal | undefined
  readonly press: () => void
}

export function useCommand(request: CommandRequest, onCarriedOut?: () => void): Command {
  const [sending, setSending] = useState(false)
  const [refusal, setRefusal] = useState<Refusal | undefined>(undefined)

  function press() {
    setSending(true)
    setRefusal(undefined)
    void sendCommand(request).then(answer => {
      setSending(false)
      setRefusal(answer)
      if (answer === undefined) onCarriedOut?.()
    })
  }

  return { sending, refusal, press }
}
