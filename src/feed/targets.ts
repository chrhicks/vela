import { Context, Effect } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http'
import type { Refusal } from '../../state/commands.ts'
import { TargetSearch, targetsPath, type TargetFound } from '../../state/targets.ts'

export class Targets extends Context.Service<Targets, { readonly search: (text: string) => Effect.Effect<ReadonlyArray<TargetFound>> }>()('vela/Targets') {}

const malformed: Refusal = { code: 'malformed' }

export const TargetsRoute = HttpRouter.add(
  'GET',
  targetsPath,
  Effect.gen(function* () {
    const targets = yield* Targets
    const { q } = yield* HttpServerRequest.schemaSearchParams(TargetSearch)

    return HttpServerResponse.jsonUnsafe(yield* targets.search(q), { headers: { 'cache-control': 'no-store' } })
  }).pipe(Effect.catchTag('SchemaError', () => Effect.succeed(HttpServerResponse.jsonUnsafe(malformed, { status: 400 })))),
)
