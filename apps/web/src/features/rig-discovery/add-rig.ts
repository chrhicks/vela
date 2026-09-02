import type { RigEndpoint, RigId } from '@vela/model/rig'
import { api, ApiError } from '../../lib/api'

export type AddRigFailure =
  | 'already-added'
  | 'conflict'
  | 'inspection-failed'
  | 'no-stable-device-id'
  | 'unknown'

export class AddRigError extends Error {
  constructor(readonly reason: AddRigFailure) {
    super('Could not add the Rig')
    this.name = 'AddRigError'
  }
}

export async function addRig(
  name: string,
  endpoint: RigEndpoint,
  signal: AbortSignal,
): Promise<RigId> {
  try {
    const response = await api<{ rigId: RigId }>('rigs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, endpoint }),
      signal,
    })
    return response.rigId
  } catch (error) {
    if (!(error instanceof ApiError)) throw error

    switch (error.code) {
      case 'rig-already-added':
        throw new AddRigError('already-added')
      case 'rig-conflict':
        throw new AddRigError('conflict')
      case 'no-stable-device-id':
        throw new AddRigError('no-stable-device-id')
      case 'rig-inspection-failed':
        throw new AddRigError('inspection-failed')
      default:
        throw new AddRigError('unknown')
    }
  }
}
