import type { MountControlAction, MountControlView } from '@vela/model/web'
import { z } from 'zod'
import { api } from '../../lib/api'
import { mountControlSchema } from './control-schema'

/**
 * A new command's request ID (UUID v4). It comes from `crypto.getRandomValues` because
 * `crypto.randomUUID` exists only in secure contexts, and Vela is served over plain HTTP on the
 * home network (for example `http://polaris.local:5173` on a phone).
 */
export function createRequestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))

  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

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
    // The request stays open for the whole home, which Cria bounds at three minutes.
    signal: AbortSignal.timeout(action === 'home' ? 200_000 : 30_000),
  })

  const view = mountControlSchema.parse(response)

  if (view.serverInstanceId !== serverInstanceId || view.command?.requestId !== requestId || view.command.action !== action)
    throw new Error('Mount command response does not match the request')

  return view
}

const stopSchema = z.object({
  outcome: z.enum(['confirmed', 'failed', 'uncertain']),
  message: z.string().nullable(),
})

/** Stop has no request ID: it only stops motion, so sending it again is safe. */
export async function stopMount(rigId: string, deviceId: string) {
  const response = await api(`rigs/${encodeURIComponent(rigId)}/mount/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId }),
    signal: AbortSignal.timeout(30_000),
  })

  return stopSchema.parse(response)
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
