import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { Attestation } from './attestation.js'

const emptyBody = z.strictObject({})

export function registerAttestation(app: FastifyInstance, attestation: Pick<Attestation, 'pin'>) {
  app.post('/api/attestation/pin', async (request, reply) => {
    if (!request.headers['content-type']?.startsWith('application/json') || !emptyBody.safeParse(request.body).success)
      return reply.code(400).send({ error: 'Expected an empty JSON object' })

    await attestation.pin()

    return { status: 'pinned' }
  })
}
