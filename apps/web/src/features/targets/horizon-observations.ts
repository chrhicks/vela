import type { HorizonObservationsView } from '@vela/model/web'
import { z } from 'zod'
import { api } from '../../lib/api'

const observation = z.object({
  id: z.string().min(1),
  at: z.string().refine(value => Number.isFinite(Date.parse(value))),
  altitudeDegrees: z.number().min(0).max(90),
  azimuthDegrees: z.number().min(0).lt(360),
  strongBefore: z.number().int().nonnegative(),
  strongAt: z.number().int().nonnegative(),
  runId: z.string().min(1),
})

const view = z.object({ rigId: z.string().min(1), observations: z.array(observation) })

const path = (rigId: string) => `rigs/${encodeURIComponent(rigId)}/horizon-observations`

export async function fetchHorizonObservations(rigId: string, signal: AbortSignal): Promise<HorizonObservationsView> {
  const parsed = view.safeParse(await api(`web/${path(rigId)}`, { signal }))

  if (!parsed.success || parsed.data.rigId !== rigId) throw new Error('Invalid horizon observations response')

  return parsed.data
}

export async function deleteHorizonObservation(rigId: string, id: string) {
  await api(`${path(rigId)}/${encodeURIComponent(id)}`, { method: 'DELETE', signal: AbortSignal.timeout(15000) })
}
