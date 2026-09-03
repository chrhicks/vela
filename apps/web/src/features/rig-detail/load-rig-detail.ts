import type { RigDetailView } from '@vela/model/web'
import { api } from '../../lib/api'
import { isRigDetailView } from '../../lib/view-validation'

export async function loadRigDetail(
  rigId: string,
  signal?: AbortSignal,
): Promise<RigDetailView> {
  const response = await api<unknown>(`web/rigs/${encodeURIComponent(rigId)}`, { signal })
  if (!isRigDetailView(response)) throw new Error('Invalid Rig detail response')
  return response
}
