import type { Schema } from 'effect'
import type { CriaExchangeBody, CriaImageBody, CriaStreamBody } from './bodies.ts'
import { seal } from './codec.ts'
import type { RigEvent } from './event.ts'
import { epochMs, type RigId, type SourceId } from './primitives.ts'
import type { State } from './wire.ts'

type Exchange = Omit<typeof CriaExchangeBody.Type, 'command' | 'reply'> & {
  readonly command: { readonly requestId: string; readonly deviceId: string; readonly kind: string; readonly parameters: unknown } | null
  readonly reply:
    | { readonly kind: 'answered'; readonly body: unknown }
    | { readonly kind: 'refused'; readonly code: string; readonly message: string }
    | { readonly kind: 'lost'; readonly message: string }
}

/**
 * What Vela's Cria client reports, before it has a rig or a source. Bodies are plain JSON in the log, so a
 * decoded wire value goes through `JSON.stringify` on the way in.
 */
export type CriaEntry =
  | { readonly kind: 'state'; readonly at: number; readonly origin: string; readonly state: State }
  | ({ readonly kind: 'exchange'; readonly at: number } & Exchange)
  | ({ readonly kind: 'image'; readonly at: number } & typeof CriaImageBody.Type)
  | ({ readonly kind: 'stream'; readonly at: number } & typeof CriaStreamBody.Type)

function instant(ms: number, fallback = 0) {
  return epochMs(Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : fallback)
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- A decoded wire value can be any JSON-shaped value.
function plain(value: unknown): Schema.Json | undefined {
  try {
    const text = JSON.stringify(value)

    return text === undefined ? undefined : JSON.parse(text)
  } catch {
    return null
  }
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- A decoded wire value can be any JSON-shaped value.
function present<K extends string>(key: K, value: unknown): { readonly [P in K]?: Schema.Json } {
  const json = plain(value)

  // SAFETY: the one key is either absent or holds the JSON the value became.
  return (json === undefined ? {} : { [key]: json }) as { readonly [P in K]?: Schema.Json }
}

/**
 * Wraps one client entry in an envelope. A state entry keeps the whole snapshot, so a reading that only
 * has a new `observedAt` is still there. It never throws: the log must not switch itself off over one entry.
 */
export function criaEvent(entry: CriaEntry, context: { readonly rig: RigId; readonly source: SourceId }): RigEvent {
  const arrived = instant(entry.at)
  const stamp = { rig: context.rig, source: context.source, seenAt: arrived } as const

  switch (entry.kind) {
    case 'state':
      return seal({
        ...stamp,
        kind: 'cria.state',
        at: instant(entry.state.generatedAt, arrived),
        body: { origin: entry.origin, freshness: 'observed', state: entry.state },
      })
    case 'exchange': {
      const { kind: _kind, at: _at, command, reply, ...rest } = entry

      return seal({
        ...stamp,
        kind: 'cria.exchange',
        at: arrived,
        body: {
          ...rest,
          command: command && { requestId: command.requestId, deviceId: command.deviceId, kind: command.kind, ...present('parameters', command.parameters) },
          reply: reply.kind === 'answered' ? { kind: 'answered', ...present('body', reply.body) } : reply,
        },
      })
    }

    case 'image': {
      const { kind: _kind, at: _at, ...body } = entry

      return seal({ ...stamp, kind: 'cria.image', at: arrived, body })
    }

    case 'stream': {
      const { kind: _kind, at: _at, ...body } = entry

      return seal({ ...stamp, kind: 'cria.stream', at: arrived, body })
    }
  }
}
