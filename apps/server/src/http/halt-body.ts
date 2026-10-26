import type { FastifyInstance } from 'fastify'

export const haltBodyError = 'Send this request as a POST with an empty body.'

// A halt route takes no input, so its one accepted form is a POST whose body is zero bytes, under
// any content type or none (clients add a Content-Type out of habit). A route refuses anything
// else with haltBodyError when request.body is not undefined. Fastify would otherwise reject an
// empty body under application/json, and parse text/plain on its own, before the handler runs.
// The routes in this scope that do take a body (the framing and alignment start, check and
// center commands) read it as JSON, or as the raw text when it is not JSON, and validate it
// themselves.
export function registerHaltRoutes(app: FastifyInstance, routes: (scope: FastifyInstance) => void) {
  void app.register(async scope => {
    const parseJson = scope.getDefaultJsonParser('error', 'error')

    scope.addContentTypeParser(['application/json', 'text/plain', '*'], { parseAs: 'string' }, (request, body, done) => {
      const text = body.toString()

      if (text === '') return done(null, undefined)
      parseJson(request, text, (error, parsed) => done(null, error ? text : parsed))
    })
    routes(scope)
  })
}
