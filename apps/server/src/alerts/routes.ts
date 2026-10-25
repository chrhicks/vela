import { z } from 'zod'
import type { AlertsView } from '@vela/model/web'
import type { FastifyInstance } from 'fastify'
import type { RigCatalog } from '../rig/catalog.js'
import { createAlertMonitor, type AlertMonitor } from './monitor.js'
import type { Notifier } from './notifier.js'
import { createMemoryPhoneAlertsPreference, type PhoneAlertsPreference } from './preference.js'
import type { MountReading } from './rules.js'
import type { AlertThresholds } from './thresholds.js'

export interface AlertsOptions {
  thresholds: AlertThresholds
  /** Null when no Pushover keys are configured: alerts then show in Vela only. */
  notifier: Notifier | null
  /** Whether each rig's alerts may page the phone; defaults to on and is lost on restart. */
  phoneAlerts?: PhoneAlertsPreference
  mountReaderFor?: (rigId: string) => (signal: AbortSignal) => Promise<MountReading | null>
  now?: () => number
}

const emptyBody = z.strictObject({})

const phoneAlertsBody = z.strictObject({ on: z.boolean() })

// The browser reads this shape from @vela/model; the annotation keeps the monitor's view assignable to it.
const viewOf = (monitor: AlertMonitor): AlertsView => monitor.view()

export function registerAlerts(
  app: FastifyInstance,
  catalog: RigCatalog,
  { thresholds, notifier, phoneAlerts = createMemoryPhoneAlertsPreference(), mountReaderFor, now }: AlertsOptions,
) {
  const monitors = new Map<string, AlertMonitor>()

  function monitorFor(rig: { id: string; name: string }) {
    let monitor = monitors.get(rig.id)

    if (!monitor) {
      monitor = createAlertMonitor({
        rigId: rig.id,
        rigName: rig.name,
        thresholds,
        notifier,
        phoneAlertsOn: phoneAlerts.isOn(rig.id),
        ...(mountReaderFor && { readMount: mountReaderFor(rig.id) }),
        ...(now && { now }),
      })

      monitors.set(rig.id, monitor)
    }

    return monitor
  }

  app.get<{ Params: { rigId: string } }>('/api/web/rigs/:rigId/alerts', async (request, reply) => {
    const rig = await catalog.get(request.params.rigId)

    if (!rig) return reply.code(404).send({ error: 'rig-not-found' })

    return viewOf(monitorFor(rig))
  })

  app.post<{ Params: { rigId: string; id: string } }>(
    '/api/rigs/:rigId/alerts/:id/acknowledge',
    async (request, reply) => {
      if (!request.headers['content-type']?.startsWith('application/json') || !emptyBody.safeParse(request.body).success)
        return reply.code(400).send({ error: 'Expected an empty JSON object' })

      const rig = await catalog.get(request.params.rigId)

      if (!rig) return reply.code(404).send({ error: 'rig-not-found' })

      const monitor = monitorFor(rig)
      const result = await monitor.acknowledge(request.params.id)

      if (result.outcome === 'not-active') return reply.code(404).send({ error: 'alert-not-active' })

      // The phone is still repeating, so the alert is not acknowledged.
      if (result.outcome === 'phone-failed')
        return reply.code(502).send({ error: 'phone-cancel-failed', reason: result.reason })

      return viewOf(monitor)
    },
  )

  app.put<{ Params: { rigId: string } }>('/api/rigs/:rigId/alerts/phone', async (request, reply) => {
    const body = phoneAlertsBody.safeParse(request.body)

    if (!request.headers['content-type']?.startsWith('application/json') || !body.success)
      return reply.code(400).send({ error: 'Expected { "on": true | false }' })

    const rig = await catalog.get(request.params.rigId)

    if (!rig) return reply.code(404).send({ error: 'rig-not-found' })

    try {
      await phoneAlerts.set(rig.id, body.data.on)
    } catch {
      return reply.code(500).send({ error: 'phone-alerts-not-saved' })
    }

    const monitor = monitorFor(rig)

    await monitor.setPhoneAlerts(body.data.on)

    return viewOf(monitor)
  })

  app.post<{ Params: { rigId: string } }>('/api/rigs/:rigId/alerts/test', async (request, reply) => {
    if (!request.headers['content-type']?.startsWith('application/json') || !emptyBody.safeParse(request.body).success)
      return reply.code(400).send({ error: 'Expected an empty JSON object' })

    const rig = await catalog.get(request.params.rigId)

    if (!rig) return reply.code(404).send({ error: 'rig-not-found' })

    const monitor = monitorFor(rig)
    const result = await monitor.sendTest()

    if (result.outcome === 'not-configured')
      return reply.code(409).send({ error: 'phone-alerts-not-configured' })

    if (result.outcome === 'off') return reply.code(409).send({ error: 'phone-alerts-off' })

    if (result.outcome === 'failed')
      return reply.code(502).send({ error: 'phone-alerts-failing', reason: result.reason })

    return viewOf(monitor)
  })

  app.addHook('onClose', async () => {
    for (const monitor of monitors.values()) monitor.close()
  })

  return { monitorFor }
}
