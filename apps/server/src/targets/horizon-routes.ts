import type { HorizonObservationsView } from '@vela/model/web'
import type { FastifyInstance } from 'fastify'
import type { RigCatalog } from '../rig/catalog.js'
import type { ObservationStore } from './horizon-observations.js'

/** Lists the observed obstructions of a rig and lets Chris delete a wrong one. Deleting is the only edit. */
export function registerHorizonObservations(app: FastifyInstance, catalog: RigCatalog, store: ObservationStore) {
  app.get<{ Params: { rigId: string } }>('/api/web/rigs/:rigId/horizon-observations', async (request, reply) => {
    const rig = await catalog.get(request.params.rigId)

    if (!rig) return reply.code(404).send({ error: 'rig-not-found' })

    const view: HorizonObservationsView = {
      rigId: rig.id,
      observations: (await store.list(rig.id)).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
    }

    return view
  })

  app.delete<{ Params: { rigId: string; id: string } }>(
    '/api/rigs/:rigId/horizon-observations/:id',
    async (request, reply) => {
      const rig = await catalog.get(request.params.rigId)

      if (!rig) return reply.code(404).send({ error: 'rig-not-found' })

      try {
        if (!(await store.remove(rig.id, request.params.id)))
          return reply.code(404).send({ error: 'observation-not-found' })
      } catch (error) {
        request.log.warn({ err: error }, 'Horizon observation could not be deleted')

        return reply.code(409).send({ error: 'observations-unusable' })
      }

      return reply.code(204).send()
    },
  )
}
