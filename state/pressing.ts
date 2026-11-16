import { Schema } from 'effect'
import type { RigEntry } from './entries.ts'

export const Pressing = Schema.Record(Schema.String, Schema.Struct({ command: Schema.String, key: Schema.optional(Schema.String), at: Schema.Number }))

export type Pressing = typeof Pressing.Type

export const nothingPressed: Pressing = {}

export function pressing(state: Pressing, entry: RigEntry): Pressing {
  switch (entry.kind) {
    case 'vela.command.pressed':
      return { ...state, [entry.body.id]: { command: entry.body.command, key: entry.body.key, at: entry.at } }
    case 'vela.command.answered':
      return Object.fromEntries(Object.entries(state).filter(([id]) => id !== entry.body.id))
    default:
      return state
  }
}

export const pressedSince = (state: Pressing, since: number): Pressing => Object.fromEntries(Object.entries(state).filter(([, pressed]) => pressed.at >= since))

export const pressKey = (request: Readonly<Record<string, unknown>>) => JSON.stringify(Object.entries(request).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))

export const isPressed = (state: Pressing, key: string) => Object.values(state).some(pressed => pressed.key === key)
