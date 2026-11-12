import { Result } from 'effect'
import { readWire, type Entry, type WireBody } from '../../state/entry.ts'

type JsonRecord = Readonly<Record<string, unknown>>

export function recordOf(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonRecord) : undefined
}

export function readWireBody(entry: Entry): WireBody | undefined {
  return Result.getOrUndefined(readWire(entry))
}
