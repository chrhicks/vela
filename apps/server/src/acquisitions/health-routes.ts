import type { FastifyBaseLogger, FastifyInstance } from 'fastify'
import type { ArchiveHealthView } from '@vela/model/web'
import type { RigCatalog } from '../rig/catalog.js'
import type { RigEquipmentSource } from '../rig/contracts.js'
import type { ArchiveHealth } from '../cria/archive-health.js'

/**
 * Preservation health for a rig: read-only view, plus a reconcile action that reruns the
 * existing recovery pass. Neither sends an equipment command.
 */
export function registerArchiveHealth(
  app: FastifyInstance,
  catalog: RigCatalog,
  healthFor: (rig: RigEquipmentSource) => ArchiveHealth | undefined,
) {
  async function respond(rigId: string, read: (health: ArchiveHealth) => ReturnType<ArchiveHealth['view']>) {
    const rig = await catalog.get(rigId)

    if (!rig) return { code: 404, body: { error: 'Rig not found' } }

    const health = healthFor(rig)

    if (!health) {
      const view: ArchiveHealthView = { rigId: rig.id, rigName: rig.name, preservation: 'none' }

      return { code: 200, body: view }
    }

    const view: ArchiveHealthView = { rigId: rig.id, rigName: rig.name, preservation: 'cria', ...await read(health) }

    return { code: 200, body: view }
  }

  async function handle(
    rigId: string,
    read: (health: ArchiveHealth) => ReturnType<ArchiveHealth['view']>,
    log: FastifyBaseLogger,
  ) {
    try {
      return await respond(rigId, read)
    } catch (error) {
      log.error(error, 'Archive health is unavailable')

      return { code: 503, body: { error: 'Archive health is unavailable. Check that the Vela server is running.' } }
    }
  }

  app.get<{ Params: { rigId: string } }>('/api/web/rigs/:rigId/archive', async (request, reply) => {
    reply.header('cache-control', 'no-store')
    const { code, body } = await handle(request.params.rigId, health => health.view(), request.log)

    return reply.code(code).send(body)
  })

  app.post<{ Params: { rigId: string } }>('/api/rigs/:rigId/archive/reconcile', async (request, reply) => {
    reply.header('cache-control', 'no-store')
    const { code, body } = await handle(request.params.rigId, health => health.reconcile(), request.log)

    return reply.code(code).send(body)
  })
}
