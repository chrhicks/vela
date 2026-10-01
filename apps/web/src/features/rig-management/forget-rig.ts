import type { RigId } from '@vela/model/rig'
import { api, ApiError } from '../../lib/api'

export async function forgetRig(rigId: RigId): Promise<'confirmed' | 'rejected' | 'unconfirmed'> {
  try {
    const response = await api(`rigs/${encodeURIComponent(rigId)}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(15000),
    })

    return response === undefined ? 'confirmed' : 'unconfirmed'
  } catch (cause) {
    return cause instanceof ApiError && [400, 404, 409].includes(cause.status) ? 'rejected' : 'unconfirmed'
  }
}
