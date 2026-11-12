import type { Entry } from '../../state/entry.ts'
import { readWireBody } from '../stream/json.ts'

export interface Reading {
  readonly celsius: number
  readonly at: number
}

export interface Focused {
  readonly position: number
  readonly at: number
  readonly celsius: number | undefined
}

export interface FocusDrift {
  readonly now: Reading | undefined
  readonly focused: Focused | undefined
}

export function makeFocusDrift(focuser: string) {
  let now: Reading | undefined
  let focused: Focused | undefined
  let position: number | undefined
  let moving = false

  return {
    observe(entry: Entry) {
      if (entry.kind === 'client.connected') {
        now = undefined
        focused = undefined
        position = undefined
        moving = false

        return
      }

      if (entry.kind !== 'wire') return

      const wire = readWireBody(entry)

      if (wire === undefined || wire.dir !== 'in' || wire.device !== focuser) return

      const temperature = wire.elements['TEMPERATURE']

      if (wire.property === 'FOCUS_TEMPERATURE' && typeof temperature === 'number') now = { celsius: temperature, at: entry.at }

      if (wire.property !== 'ABS_FOCUS_POSITION') return

      const value = wire.elements['FOCUS_ABSOLUTE_POSITION']

      if (wire.state === 'Busy') moving = true
      else if (typeof value === 'number') {
        if (wire.type === 'set' && (moving || (position !== undefined && value !== position))) focused = { position: value, at: entry.at, celsius: now?.celsius }
        position = value
        moving = false
      }
    },

    view(): FocusDrift {
      return { now, focused }
    },
  }
}
