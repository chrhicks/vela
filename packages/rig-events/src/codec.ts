import { Cause, Exit, Schema } from 'effect'
import { canonicalJson } from './hash.ts'
import { RigEventSchema, type Draft, type RigEvent } from './event.ts'
import { eventIdOf } from './ids.ts'

export type DecodeResult<E> =
  | { readonly ok: true; readonly event: E }
  | { readonly ok: false; readonly error: string; readonly raw: unknown }

const decodeExit = Schema.decodeUnknownExit(RigEventSchema)

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the parse boundary: the schema decides what raw is.
export function decodeEvent(raw: unknown): DecodeResult<RigEvent> {
  const exit = decodeExit(raw)

  return Exit.isSuccess(exit) ? { ok: true, event: exit.value } : { ok: false, error: Cause.pretty(exit.cause), raw }
}

/** One canonical JSON line: the same bytes on the wire and in an archive file, whatever order a producer built the keys in. */
export function encodeEvent(event: RigEvent): string {
  return canonicalJson(event)
}

export function decodeLine(line: string): DecodeResult<RigEvent> {
  try {
    return decodeEvent(JSON.parse(line))
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), raw: line }
  }
}

export function seal(draft: Draft): RigEvent {
  return { v: 1, id: eventIdOf(draft), ...draft }
}
