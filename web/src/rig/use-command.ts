import { useState } from 'react'

import type { CommandRequest } from '../../../state/commands.ts'
import { sendCommand, type Answer } from './commands.ts'

export interface Command {
  readonly sending: boolean
  readonly answer: Answer | undefined
  readonly press: () => void
}

export function useCommand(request: CommandRequest, onAnswer?: (answer: Answer) => void): Command {
  const [sending, setSending] = useState(false)
  const [answer, setAnswer] = useState<Answer | undefined>(undefined)

  function press() {
    setSending(true)
    setAnswer(undefined)
    void sendCommand(request).then(received => {
      setSending(false)
      setAnswer(received)
      onAnswer?.(received)
    })
  }

  return { sending, answer, press }
}
