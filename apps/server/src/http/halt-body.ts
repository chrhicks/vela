import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

export const haltBody = z.strictObject({}).optional()

export const haltBodyError = 'Expected no body or an empty JSON object'

// Fastify refuses a JSON content type with no body, and any other content type, before a handler
// runs. A halt route registers through here so every such request reaches it with the body parsed
// as JSON, or absent when empty, the same as a bare POST.
export function registerHaltRoutes(app: FastifyInstance, routes: (scope: FastifyInstance) => void) {
  void app.register(async scope => {
    const parseJson = scope.getDefaultJsonParser('error', 'error')

    scope.addContentTypeParser(['application/json', '*'], { parseAs: 'string' }, (request, body, done) => {
      const text = body.toString()

      if (text === '') return done(null, undefined)
      parseJson(request, text, done)
    })
    routes(scope)
  })
}
