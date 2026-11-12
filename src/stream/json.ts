import { Option } from 'effect'
import { decodeWireBody, type WireBody } from '../../state/entry.ts'

type JsonRecord = Readonly<Record<string, unknown>>

export function recordOf(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonRecord) : undefined
}

export function readWireBody(body: unknown): WireBody | undefined {
  return Option.getOrUndefined(decodeWireBody(body))
}
