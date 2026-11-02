import { kinds, seal, sourceId, type EventId, type RigEvent, type RigId } from '@vela/rig-events'
import { assess, createModel, defaultConfig, step, type RigModel, type Assessment } from '@vela/rig-model'

export const shadowModelSource = sourceId('model:shadow-v1')

export interface StreamState {
  readonly rigs: ReadonlyMap<RigId, { model: RigModel; published: EventId | null }>
  readonly sequences: ReadonlyMap<string, number>
}

export function createStreamModel(state?: StreamState) {
  const rigs = new Map(state?.rigs)
  const sequences = new Map(state?.sequences)

  return {
    accept(event: RigEvent & { broker?: { stream: string; sequence: number } }): RigEvent[] {
      if (kinds[event.kind].branch !== 'fact') return []

      if (event.broker) {
        if (event.broker.sequence <= (sequences.get(event.broker.stream) ?? 0)) return []
        sequences.set(event.broker.stream, event.broker.sequence)
      }

      const previous = rigs.get(event.rig)
      const model = previous?.model ?? createModel(defaultConfig(event.rig, shadowModelSource))
      const applied = step(model, event)
      const advanced = step(applied.model, { kind: 'clock', at: event.seenAt })

      rigs.set(event.rig, { model: advanced.model, published: previous?.published ?? null })

      return [...applied.out, ...advanced.out].map(draft => seal(draft))
    },
    snapshot(): StreamState { return { rigs, sequences } },
    published(event: RigEvent) {
      const state = rigs.get(event.rig)

      if (state) rigs.set(event.rig, { ...state, published: event.id })
    },
    get(rig: RigId): Assessment | null {
      const state = rigs.get(rig)

      return state ? assess(state.model) : null
    },
  }
}
