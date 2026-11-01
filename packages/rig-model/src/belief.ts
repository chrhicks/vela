import type { EpochMs, EventId } from '@vela/rig-events'

export type Scope = 'setup' | 'site' | 'rig'

export type Confidence = 'none' | 'low' | 'high'

/**
 * What the model holds about one thing. `setup` beliefs start unknown with every outing, `site` beliefs
 * belong to the place and `rig` beliefs to the hardware; both carry over. Evidence is event ids, never copies.
 */
export interface Belief<V, S extends Scope = Scope> {
  readonly value: V
  readonly confidence: Confidence
  readonly lastSeen: EpochMs
  readonly evidence: readonly EventId[]
  readonly scope: S
}

const evidenceKept = 8

export function believe<V, S extends Scope>(
  scope: S,
  value: V,
  confidence: Confidence,
  lastSeen: EpochMs,
  evidence: readonly EventId[],
): Belief<V, S> {
  return { value, confidence, lastSeen, evidence: evidence.slice(-evidenceKept), scope }
}
