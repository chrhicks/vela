import type { DewControlAction, DewControlView } from '@vela/model/web'
import { z } from 'zod'
import { api } from '../../lib/api'
import { dewControlSchema } from './control-schema'

export async function sendDewCommand(
  rigId: string,
  deviceId: string,
  action: DewControlAction,
  requestId: string,
  serverInstanceId: string,
): Promise<DewControlView> {
  const response = await api(`rigs/${encodeURIComponent(rigId)}/dew`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, action, requestId, serverInstanceId }),
    signal: AbortSignal.timeout(30_000),
  })

  const view = dewControlSchema.parse(response)

  if (view.serverInstanceId !== serverInstanceId || view.command?.requestId !== requestId)
    throw new Error('Dew heater response does not match the request')

  return view
}

/** Retire an unseen request before reading state; this never sends a device command. */
export async function checkDewCommand(rigId: string, deviceId: string, command: { requestId: string; serverInstanceId: string }) {
  const response = await api(`rigs/${encodeURIComponent(rigId)}/dew/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, requestId: command.requestId, serverInstanceId: command.serverInstanceId }),
    signal: AbortSignal.timeout(10_000),
  })

  return z.object({
    admission: z.enum(['not-admitted', 'known', 'unknown']),
    control: dewControlSchema,
  }).parse(response)
}
