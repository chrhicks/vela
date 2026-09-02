import type { DiscoveryResultView } from '@vela/model/rig'
import { api } from '../../lib/api'

export type DiscoverRigsRequest =
  | { mode: 'scan' }
  | { mode: 'manual'; host: string; port: number }

export function discoverRigs(
  request: DiscoverRigsRequest,
  signal: AbortSignal,
): Promise<DiscoveryResultView> {
  return api<DiscoveryResultView>('rigs/discovery', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
    signal,
  })
}
