import { canonicalJson, fnv1a64 } from './hash.ts'
import type { Draft } from './event.ts'
import { eventId as brandEventId, type EventId, type RigId } from './primitives.ts'
import { kinds, type Branch, type Kind } from './registry.ts'

export const subjectRoot = 'rig.v1'

export function subjectOf(rig: RigId, kind: Kind): string {
  return `${subjectRoot}.${rig}.${kinds[kind].branch}.${kind}`
}

export function branchFilter(branch: Branch): string {
  return `${subjectRoot}.*.${branch}.>`
}

function contentKey(draft: Draft): string {
  return `${draft.kind}:${draft.at}:${fnv1a64(canonicalJson(draft.body))}`
}

/** The same fact always gets the same id, so a republish or a re-import converges on one event. */
export function eventIdOf(draft: Draft): EventId {
  switch (draft.kind) {
    case 'cria.state':
      return brandEventId(`state:${draft.body.freshness}:${draft.body.state.instanceId}:${draft.body.state.sequence}`)
    case 'frame':
      return brandEventId(draft.body.image ? `frame:${draft.body.image.id}` : `frame:${draft.body.runId}:${draft.body.attempt}`)
    case 'solve':
      return brandEventId(`solve:${draft.body.imageId}:${draft.body.solverVersion}`)
    case 'session':
      return brandEventId(`session:${draft.body.setupId}:${draft.body.phase}`)
    case 'gap':
      return brandEventId(`gap:${draft.body.source}:${draft.body.from}`)
    case 'cria.exchange':
    case 'cria.image':
    case 'cria.stream':
    case 'mount-position':
    case 'pointing-fix':
      return brandEventId(contentKey(draft))
  }
}
