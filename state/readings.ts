import { Schema } from 'effect'
import type { RigEntry } from './entries.ts'
import { PropertyState, Value, type WireBody } from './entry.ts'

export const Reading = Schema.Struct({
  state: Schema.optional(PropertyState),
  values: Schema.Record(Schema.String, Value),
  at: Schema.Number,
})

export type Reading = typeof Reading.Type

export const Readings = Schema.Record(Schema.String, Schema.Record(Schema.String, Reading))

export type Readings = typeof Readings.Type

type DeviceReadings = Readings[string]

const sameValues = (before: Reading['values'], after: Reading['values']) =>
  Object.keys(after).length === Object.keys(before).length && Object.entries(after).every(([name, value]) => before[name] === value)

function withReading(state: Readings, wire: WireBody, property: string, at: number): Readings {
  const device: DeviceReadings = state[wire.device] ?? {}
  const before = device[property]
  const values = { ...before?.values, ...wire.elements }

  if (before !== undefined && before.state === wire.state && sameValues(before.values, values)) return state

  return { ...state, [wire.device]: { ...device, [property]: { state: wire.state, values, at } } }
}

function withoutReading(state: Readings, wire: WireBody): Readings {
  const device = state[wire.device]

  if (device === undefined) return state
  if (wire.property === undefined) return Object.fromEntries(Object.entries(state).filter(([name]) => name !== wire.device))
  if (device[wire.property] === undefined) return state

  return { ...state, [wire.device]: Object.fromEntries(Object.entries(device).filter(([name]) => name !== wire.property)) }
}

function deviceReported(state: Readings, wire: WireBody, at: number): Readings {
  if (wire.dir !== 'in') return state
  if (wire.type === 'del') return withoutReading(state, wire)
  if ((wire.type === 'def' || wire.type === 'set') && wire.property !== undefined) return withReading(state, wire, wire.property, at)

  return state
}

const forgotten: Readings = {}

export function readings(state: Readings, entry: RigEntry): Readings {
  switch (entry.kind) {
    case 'wire':
      return deviceReported(state, entry.body, entry.at)
    case 'client.connected':
      return forgotten
    case 'client.connection':
      return entry.body.target === 'indiserver' && entry.body.status !== 'connected' ? forgotten : state
    default:
      return state
  }
}
