import { Context, Effect } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http'
import type { Refusal } from '../../state/commands.ts'
import { bestPlacedPath, TargetSearch, targetsPath, type TargetFound } from '../../state/targets.ts'

export class Targets extends Context.Service<Targets, { readonly search: (text: string) => Effect.Effect<ReadonlyArray<TargetFound>>; readonly bestPlaced: Effect.Effect<ReadonlyArray<TargetFound>> }>()('vela/Targets') {}

const malformed: Refusal = { code: 'malformed' }

const answer = (found: ReadonlyArray<TargetFound>) => HttpServerResponse.jsonUnsafe(found, { headers: { 'cache-control': 'no-store' } })

export const BestPlacedRoute = HttpRouter.add('GET', bestPlacedPath, Effect.map(Effect.flatMap(Targets, targets => targets.bestPlaced), answer))

export const TargetsRoute = HttpRouter.add(
  'GET',
  targetsPath,
  Effect.gen(function* () {
    const targets = yield* Targets
    const { q } = yield* HttpServerRequest.schemaSearchParams(TargetSearch)

    return answer(yield* targets.search(q))
  }).pipe(Effect.catchTag('SchemaError', () => Effect.succeed(HttpServerResponse.jsonUnsafe(malformed, { status: 400 })))),
)
