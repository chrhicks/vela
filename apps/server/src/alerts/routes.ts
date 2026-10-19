import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { RigCatalog } from '../rig/catalog.js'
import { createAlertMonitor, type AlertMonitor } from './monitor.js'
import type { Notifier } from './notifier.js'
import type { MountReading } from './rules.js'
import type { AlertThresholds } from './thresholds.js'

export interface AlertsOptions {
  thresholds: AlertThresholds
  /** Null when no Pushover keys are configured: alerts then show in Vela only. */
  notifier: Notifier | null
  mountReaderFor?: (rigId: string) => (signal: AbortSignal) => Promise<MountReading | null>
  now?: () => number
}

const emptyBody = z.strictObject({})

export function registerAlerts(
  app: FastifyInstance,
  catalog: RigCatalog,
  { thresholds, notifier, mountReaderFor, now }: AlertsOptions,
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

    return monitorFor(rig).view()
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

      return monitor.view()
    },
  )

  app.post<{ Params: { rigId: string } }>('/api/rigs/:rigId/alerts/test', async (request, reply) => {
    if (!request.headers['content-type']?.startsWith('application/json') || !emptyBody.safeParse(request.body).success)
      return reply.code(400).send({ error: 'Expected an empty JSON object' })

    const rig = await catalog.get(request.params.rigId)

    if (!rig) return reply.code(404).send({ error: 'rig-not-found' })

    const monitor = monitorFor(rig)
    const result = await monitor.sendTest()

    if (result.outcome === 'not-configured')
      return reply.code(409).send({ error: 'phone-alerts-not-configured' })

    if (result.outcome === 'failed')
      return reply.code(502).send({ error: 'phone-alerts-failing', reason: result.reason })

    return monitor.view()
  })

  app.addHook('onClose', async () => {
    for (const monitor of monitors.values()) monitor.close()
  })

  return { monitorFor }
}
