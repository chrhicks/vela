import { Schema } from 'effect'
import type { RigEntry } from './entries.ts'
import { Value, type WireBody } from './entry.ts'

export const Write = Schema.Struct({ values: Schema.Record(Schema.String, Value), at: Schema.Number })

export type Write = typeof Write.Type

export const Writes = Schema.Record(Schema.String, Schema.Record(Schema.String, Write))

export type Writes = typeof Writes.Type

const nothingPending: Writes = {}

const without = <V>(record: Readonly<Record<string, V>>, name: string): Readonly<Record<string, V>> => Object.fromEntries(Object.entries(record).filter(([key]) => key !== name))

function written(state: Writes, wire: WireBody, property: string, at: number): Writes {
  return { ...state, [wire.device]: { ...state[wire.device], [property]: { values: wire.elements, at } } }
}

function answered(state: Writes, wire: WireBody, property: string): Writes {
  const device = state[wire.device]

  const write = device?.[property]

  if (device === undefined || write === undefined) return state
  if (wire.state === 'Busy' && !Object.entries(write.values).every(([element, value]) => wire.elements[element] === value)) return state

  return { ...state, [wire.device]: without(device, property) }
}

function deviceReported(state: Writes, wire: WireBody, at: number): Writes {
  if (wire.type === 'del') return wire.property === undefined ? without(state, wire.device) : answered(state, { ...wire, state: 'Ok' }, wire.property)
  if (wire.property === undefined) return state
  if (wire.dir === 'out' && wire.type === 'new') return written(state, wire, wire.property, at)
  if (wire.dir === 'in' && (wire.type === 'def' || wire.type === 'set')) return answered(state, wire, wire.property)

  return state
}

export function writes(state: Writes, entry: RigEntry): Writes {
  switch (entry.kind) {
    case 'wire':
      return deviceReported(state, entry.body, entry.at)
    case 'client.connected':
      return nothingPending
    case 'client.connection':
      return entry.body.target === 'indiserver' && entry.body.status !== 'connected' ? nothingPending : state
    default:
      return state
  }
}
