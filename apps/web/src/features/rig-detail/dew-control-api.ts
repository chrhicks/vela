import type { DewControlAction, DewControlView } from '@vela/model/web'
import { z } from 'zod'
import { api } from '../../lib/api'

const availability = z.object({ enabled: z.boolean(), reason: z.string().nullable() })

export const dewControlSchema = z.object({
  serverInstanceId: z.uuid(),
  auto: z.object({ on: z.boolean().nullable(), set: availability }).nullable(),
  channels: z.array(z.object({
    id: z.int(),
    name: z.string(),
    minimum: z.number(),
    maximum: z.number(),
    step: z.number().positive(),
    dutyPercent: z.number().nullable(),
    set: availability,
  })),
  command: z.object({
    requestId: z.uuid(),
    action: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('auto'), on: z.boolean() }),
      z.object({ kind: z.literal('duty'), channelId: z.int(), percent: z.number() }),
    ]),
    state: z.enum(['pending', 'confirmed', 'failed', 'uncertain']),
    message: z.string().nullable(),
  }).nullable(),
})

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
