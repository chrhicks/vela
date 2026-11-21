import { useEffect, useState } from 'react'
import type { ShortlistAction } from '../../../state/commands.ts'
import { sendCommand } from './commands.ts'
import { rememberedNow } from './targets.ts'

export interface Shortlist {
  readonly ids: ReadonlyArray<string> | undefined
  readonly editing: boolean
  readonly has: (target: string) => boolean
  readonly toggle: (target: string) => void
}

const shortlistNow = (): Promise<ReadonlyArray<string> | undefined> => rememberedNow().then(recalled => (recalled.status === 'recalled' ? recalled.remembered.shortlist : undefined))

export function useShortlist(): Shortlist {
  const [ids, setIds] = useState<ReadonlyArray<string> | undefined>(undefined)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    let current = true

    void shortlistNow().then(read => {
      if (current) setIds(read)
    })

    return () => {
      current = false
    }
  }, [])

  function edit(target: string, action: ShortlistAction) {
    setEditing(true)
    void sendCommand({ command: 'shortlist', target, action })
      .then(shortlistNow)
      .then(read => {
        setIds(current => read ?? current)
        setEditing(false)
      })
  }

  const has = (target: string) => ids?.includes(target) === true

  return { ids, editing, has, toggle: target => (ids === undefined || editing ? undefined : edit(target, has(target) ? 'remove' : 'add')) }
}
