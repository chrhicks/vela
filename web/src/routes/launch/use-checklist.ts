import { Option, Schema } from 'effect'
import { useEffect, useState } from 'react'

import type { NightName } from '../../../../state/entries.ts'
import { pcButton } from './checklist.ts'

const Ticked = Schema.Struct({ done: Schema.Array(Schema.String), pcPressedAt: Schema.optional(Schema.Number) })

type Ticked = typeof Ticked.Type

const nothingTicked: Ticked = { done: [] }

const decodeTicked = Schema.decodeUnknownOption(Schema.fromJsonString(Ticked))

const keyOf = (night: NightName) => `vela.launch.set-up.${night}`

function readTicked(night: NightName): Ticked {
  try {
    return Option.getOrElse(decodeTicked(window.localStorage.getItem(keyOf(night))), () => nothingTicked)
  } catch {
    return nothingTicked
  }
}

function keepTicked(night: NightName, ticked: Ticked) {
  try {
    window.localStorage.setItem(keyOf(night), JSON.stringify(ticked))
  } catch {
    return
  }
}

export interface Checklist {
  readonly done: ReadonlySet<string>
  readonly pcPressedAt: number | undefined
  readonly toggle: (item: string) => void
}

export function useChecklist(night: NightName | undefined): Checklist {
  const [ticked, setTicked] = useState<Ticked>(nothingTicked)

  useEffect(() => setTicked(night === undefined ? nothingTicked : readTicked(night)), [night])

  function toggle(item: string) {
    const done = new Set(ticked.done)
    const nowDone = !done.delete(item)

    if (nowDone) done.add(item)

    const pcPressedAt = item !== pcButton ? ticked.pcPressedAt : nowDone ? Date.now() : undefined
    const next = { done: [...done], ...(pcPressedAt === undefined ? {} : { pcPressedAt }) }

    setTicked(next)
    if (night !== undefined) keepTicked(night, next)
  }

  return { done: new Set(ticked.done), pcPressedAt: ticked.pcPressedAt, toggle }
}
