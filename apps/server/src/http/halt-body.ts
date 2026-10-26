import type { FastifyInstance } from 'fastify'

export const haltBodyError = 'Send this request as a POST with an empty body.'

// A halt route takes no input: its one accepted form is a POST with a zero-byte body, under any
// content type or none. A route refuses any other body (request.body !== undefined) with
// haltBodyError. Without this scope Fastify refuses an empty body under application/json and parses
// text/plain itself, before the handler runs. A body that is not JSON arrives as its raw text, so
// the framing and alignment commands that do take JSON fail their own validation on it.
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
