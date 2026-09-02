import type { DiscoveryResultView } from '@vela/model/rig'
import { api, ApiError } from '../../lib/api'

export type DiscoverRigsRequest =
  | { mode: 'scan' }
  | { mode: 'manual'; host: string; port: number }

export class DiscoverRigsError extends Error {
  constructor(readonly reason: 'invalid-request') {
    super('The discovery request is invalid')
    this.name = 'DiscoverRigsError'
  }
}

export async function discoverRigs(
  request: DiscoverRigsRequest,
  signal: AbortSignal,
): Promise<DiscoveryResultView> {
  try {
    return await api<DiscoveryResultView>('rigs/discovery', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal,
    })
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) {
      throw new DiscoverRigsError('invalid-request')
    }
    throw error
  }
}
