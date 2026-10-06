import type { MountControlAction, MountControlView } from '@vela/model/web'
import { z } from 'zod'
import { api } from '../../lib/api'

const availability = z.object({ enabled: z.boolean(), reason: z.string().nullable() })

export const mountControlSchema = z.object({
  serverInstanceId: z.uuid(),
  unpark: availability,
  trackingOn: availability,
  trackingOff: availability,
  command: z.object({
    requestId: z.uuid(),
    action: z.enum(['unpark', 'tracking-on', 'tracking-off']),
    state: z.enum(['pending', 'confirmed', 'failed', 'uncertain']),
    message: z.string().nullable(),
  }).nullable(),
})

export async function sendMountCommand(
  rigId: string,
  deviceId: string,
  action: MountControlAction,
  requestId: string,
  serverInstanceId: string,
): Promise<MountControlView> {
  const response = await api(`rigs/${encodeURIComponent(rigId)}/mount`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, action, requestId, serverInstanceId }),
    signal: AbortSignal.timeout(30_000),
  })

  const view = mountControlSchema.parse(response)

  if (view.serverInstanceId !== serverInstanceId || view.command?.requestId !== requestId || view.command.action !== action)
    throw new Error('Mount command response does not match the request')

  return view
}

/** Retire an unseen request before reading state; this never sends a device command. */
export async function checkMountCommand(
  rigId: string,
  deviceId: string,
  command: NonNullable<MountControlView['command']> & { serverInstanceId: string },
) {
  const response = await api(`rigs/${encodeURIComponent(rigId)}/mount/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, requestId: command.requestId, action: command.action, serverInstanceId: command.serverInstanceId }),
    signal: AbortSignal.timeout(10_000),
  })

  return z.object({
    admission: z.enum(['not-admitted', 'known', 'unknown']),
    control: mountControlSchema,
  }).parse(response)
}
