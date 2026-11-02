import { kinds, seal, sourceId, type RigEvent, type RigId } from '@vela/rig-events'
import { assess, createModel, defaultConfig, step, type RigModel, type Assessment } from '@vela/rig-model'

export const shadowModelSource = sourceId('model:shadow-v1')

export function createStreamModel() {
  const models = new Map<RigId, RigModel>()
  const assessments = new Map<RigId, Assessment>()
  const seen = new Set<RigEvent['id']>()

  return {
    accept(event: RigEvent): RigEvent[] {
      if (kinds[event.kind].branch !== 'fact' || seen.has(event.id)) return []
      seen.add(event.id)
      const model = models.get(event.rig) ?? createModel(defaultConfig(event.rig, shadowModelSource))
      const applied = step(model, event)
      const advanced = step(applied.model, { kind: 'clock', at: event.seenAt })

      models.set(event.rig, advanced.model)
      assessments.set(event.rig, assess(advanced.model))

      return [...applied.out, ...advanced.out].map(draft => seal(draft))
    },
    get(rig: RigId) {
      return assessments.get(rig) ?? null
    },
  }
}
