import type { ConnectRigDevicesResult, RigObservationView } from '@vela/model/web'
import { api } from '../../lib/api'
import { isConnectRigDevicesResult, isRigObservationView } from './validation'

export async function loadObservation(rigId: string, signal: AbortSignal): Promise<RigObservationView> {
  const value = await api(`web/rigs/${encodeURIComponent(rigId)}/observe`, { signal })

  if (!isRigObservationView(value) || value.rig.id !== rigId) {
    throw new Error('Invalid observation response')
  }

  return value
}

export async function connectDevices(rigId: string, signal: AbortSignal): Promise<ConnectRigDevicesResult> {
  const value = await api(`rigs/${encodeURIComponent(rigId)}/connections`, {
    method: 'POST',
    signal,
  })

  if (!isConnectRigDevicesResult(value) || value.view.rig.id !== rigId) {
    throw new Error('Invalid connection response')
  }

  return value
}
