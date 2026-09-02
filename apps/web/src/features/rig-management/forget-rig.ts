import type { RigId } from '@vela/model/rig'
import { api } from '../../lib/api'

export function forgetRig(rigId: RigId): Promise<void> {
  return api<void>(`rigs/${encodeURIComponent(rigId)}`, {
    method: 'DELETE',
  })
}
