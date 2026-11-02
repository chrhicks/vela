import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ModelSnapshotView, RigModelView } from '@vela/model/web'
import { assess, type RigModel } from '@vela/rig-model'
import { rigId } from '@vela/rig-events'
import { checkpointStore } from './checkpoint.js'

export function modelSnapshot(model: RigModel): ModelSnapshotView {
  const { position, lastFix } = assess(model)

  let reason = 'Current-epoch plate solve'

  if (position.state === 'moving') reason = 'Mount motion in progress'
  else if (position.state !== 'known') reason = position.reason

  return {
    observedAt: model.link.lastSeenAt,
    position: {
      state: position.state,
      since: position.since,
      reason,
    },
    lastFix,
    fixes: [...model.fixes].sort((a, b) => a.at - b.at).slice(-30),
    fixCount: model.counters.fixes,
    rejectedCount: Object.values(model.counters.rejected).reduce((sum, n) => sum + n, 0),
    skippedCount: model.counters.skippedFrames,
  }
}

export function shadowCheckpoint(directory: string | undefined) {
  return async (rig: string, now: number): Promise<RigModelView['shadow']> => {
    if (!directory) return { state: 'unavailable', checkpointAt: null, snapshot: null }

    try {
      const checkpointAt = (await stat(join(directory, 'checkpoint.json'))).mtimeMs
      const saved = await checkpointStore(directory).load()
      const model = saved?.rigs.get(rigId(rig))?.model
      const snapshot = model ? modelSnapshot(model) : null

      return {
        state: snapshot && now - checkpointAt < 15_000 ? 'available' : 'unavailable',
        checkpointAt,
        snapshot,
      }
    } catch {
      return { state: 'unavailable', checkpointAt: null, snapshot: null }
    }
  }
}
