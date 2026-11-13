import { useEffect, useRef, useState } from 'react'

import { NudgeDirection, type NudgeId, type NudgeRate, type Refusal } from '../../../../state/commands.ts'
import { RefusalLine } from '../../components/RefusalLine.tsx'
import { newNudgeId, sendCommand } from '../../rig/commands.ts'
import { useLink } from '../../rig/store.ts'
import { nudgeWords } from '../../rig/words.ts'
import styles from './NudgePad.module.css'

interface Holding {
  readonly id: NudgeId
  readonly direction: NudgeDirection
  readonly renew: number
}

export function NudgePad({ rate }: { readonly rate: NudgeRate }) {
  const holdMs = useLink().controls?.nudgeHoldMs
  const holding = useRef<Holding | undefined>(undefined)
  const [held, setHeld] = useState<NudgeDirection | undefined>(undefined)
  const [refusal, setRefusal] = useState<Refusal | undefined>(undefined)

  const letGo = () => {
    const was = holding.current

    if (was === undefined) return

    holding.current = undefined
    window.clearInterval(was.renew)
    setHeld(undefined)
    void sendCommand({ command: 'releaseNudge', id: was.id })
  }

  const press = (direction: NudgeDirection) => {
    if (holdMs === undefined) return

    letGo()

    const id = newNudgeId()
    const renew = window.setInterval(() => void sendCommand({ command: 'holdNudge', id }), holdMs)

    holding.current = { id, direction, renew }
    setHeld(direction)
    setRefusal(undefined)
    void sendCommand({ command: 'nudge', id, direction, rate }).then(answer => {
      if (answer === undefined) return

      setRefusal(answer)
      if (holding.current?.id === id) letGo()
    })
  }

  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === 'hidden') letGo()
    }

    window.addEventListener('blur', letGo)
    document.addEventListener('visibilitychange', hidden)

    return () => {
      window.removeEventListener('blur', letGo)
      document.removeEventListener('visibilitychange', hidden)
      letGo()
    }
  }, [])

  return (
    <div className={styles.nudge}>
      <div className={styles.pad} role="group" aria-label="Nudge">
        <span className={styles.label}>Nudge</span>

        {NudgeDirection.literals.map(direction => (
          <button
            key={direction}
            type="button"
            className={`${styles.key} ${styles[nudgeWords[direction]]}`}
            aria-label={`Nudge ${direction}, hold to move`}
            aria-pressed={held === direction}
            onPointerDown={event => {
              event.preventDefault()
              press(direction)
            }}
            onPointerUp={letGo}
            onPointerCancel={letGo}
            onPointerLeave={letGo}
            onContextMenu={event => event.preventDefault()}
          >
            {nudgeWords[direction]}
          </button>
        ))}
      </div>

      {refusal === undefined ? null : <RefusalLine refusal={refusal} />}
    </div>
  )
}
