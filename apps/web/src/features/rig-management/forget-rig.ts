import type { RigId } from '@vela/model/rig'
import { api } from '../../lib/api'

export async function forgetRig(rigId: RigId): Promise<void> {
  await api(`rigs/${encodeURIComponent(rigId)}`, {
    method: 'DELETE',
  })
}
