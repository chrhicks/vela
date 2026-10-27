import { z } from 'zod'
import type { AlertsView } from '@vela/model/web'

const text = z.string().refine(value => value.trim().length > 0)

const delivery = z.discriminatedUnion('state', [
  z.object({ state: z.enum(['sent', 'sending', 'covered', 'not-configured', 'attended', 'stopped']) }),
  z.object({
    state: z.literal('retrying'),
    failures: z.number().int().positive(),
    nextAttemptAt: z.number(),
    giveUpAt: z.number(),
  }),
  z.object({ state: z.literal('gave-up'), failures: z.number().int().nonnegative() }),
])

const alert = z.object({
  id: text,
  level: z.enum(['warn', 'critical']),
  message: text,
  raisedAt: z.number(),
  acknowledged: z.boolean(),
  delivery,
})

const phone = z.discriminatedUnion('state', [
  z.object({ state: z.enum(['not-configured', 'ready']) }),
  z.object({ state: z.literal('failing'), reason: text, since: z.number() }),
])

const alertsView = z.object({
  rigId: text,
  watching: z.boolean(),
  alerts: z.array(alert),
  unavailable: z.array(text),
  phone,
  unattended: z.boolean(),
  thresholds: z.record(z.string(), z.number()),
})

export function isAlertsView(value: unknown, rigId: string): value is AlertsView {
  const parsed = alertsView.safeParse(value)

  return parsed.success && parsed.data.rigId === rigId
}
