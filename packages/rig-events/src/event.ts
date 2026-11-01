import { Schema } from 'effect'
import {
  CriaExchangeBody,
  CriaImageBody,
  CriaStateBody,
  CriaStreamBody,
  FrameBody,
  GapBody,
  MountPositionBody,
  PointingFixBody,
  SessionBody,
  SolveBody,
} from './bodies.ts'
import { EpochMs, EventId, RigId, SourceId } from './primitives.ts'
import type { AssessKind, FactKind, Kind, SameMembers } from './registry.ts'

function envelope<K extends string, B extends Schema.Top>(kind: K, body: B) {
  return Schema.Struct({
    v: Schema.Literal(1),
    id: EventId,
    rig: RigId,
    kind: Schema.Literal(kind),
    at: EpochMs,
    seenAt: EpochMs,
    source: SourceId,
    body,
  })
}

export const RigEventSchema = Schema.Union([
  envelope('cria.state', CriaStateBody),
  envelope('cria.exchange', CriaExchangeBody),
  envelope('cria.image', CriaImageBody),
  envelope('cria.stream', CriaStreamBody),
  envelope('frame', FrameBody),
  envelope('solve', SolveBody),
  envelope('session', SessionBody),
  envelope('gap', GapBody),
  envelope('mount-position', MountPositionBody),
  envelope('pointing-fix', PointingFixBody),
])

export type RigEvent = typeof RigEventSchema.Type

export type Envelope<K extends Kind = Kind> = Extract<RigEvent, { readonly kind: K }>

export type Bodies = { readonly [K in Kind]: Envelope<K>['body'] }

export type Fact = Envelope<FactKind>

export type Assessment = Envelope<AssessKind>

export type Draft<E extends RigEvent = RigEvent> = E extends RigEvent ? Omit<E, 'v' | 'id'> : never

export const registryCoversEveryEvent: SameMembers<Kind, RigEvent['kind']> = true
