import { Context, Effect } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http'
import type { Refusal } from '../../state/commands.ts'
import { BestPlacedAsked, bestPlacedPath, catalogPath, TargetAsked, targetPath, TargetSearch, targetsPath, type TargetFacts, type TargetFound } from '../../state/targets.ts'

export class Targets extends Context.Service<Targets, { readonly search: (text: string) => Effect.Effect<ReadonlyArray<TargetFound>>; readonly bestPlaced: (asked: BestPlacedAsked) => Effect.Effect<ReadonlyArray<TargetFound>>; readonly facts: (id: string) => Effect.Effect<TargetFacts | undefined>; readonly size: number }>()('vela/Targets') {}

const malformed: Refusal = { code: 'malformed' }

const refused = (status: number, refusal: Refusal) => HttpServerResponse.jsonUnsafe(refusal, { status })

const answer = (found: ReadonlyArray<TargetFound> | TargetFacts) => HttpServerResponse.jsonUnsafe(found, { headers: { 'cache-control': 'no-store' } })

export const BestPlacedRoute = HttpRouter.add(
  'GET',
  bestPlacedPath,
  Effect.gen(function* () {
    const targets = yield* Targets
    const asked = yield* HttpServerRequest.schemaSearchParams(BestPlacedAsked)

    return answer(yield* targets.bestPlaced(asked))
  }).pipe(Effect.catchTag('SchemaError', () => Effect.succeed(refused(400, malformed)))),
)

export const TargetsRoute = HttpRouter.add(
  'GET',
  targetsPath,
  Effect.gen(function* () {
    const targets = yield* Targets
    const { q } = yield* HttpServerRequest.schemaSearchParams(TargetSearch)

    return answer(yield* targets.search(q))
  }).pipe(Effect.catchTag('SchemaError', () => Effect.succeed(refused(400, malformed)))),
)

export const TargetRoute = HttpRouter.add(
  'GET',
  targetPath,
  Effect.gen(function* () {
    const targets = yield* Targets
    const { id } = yield* HttpServerRequest.schemaSearchParams(TargetAsked)
    const facts = yield* targets.facts(id)

    return facts === undefined ? refused(404, { code: 'unknown-target', text: id }) : answer(facts)
  }).pipe(Effect.catchTag('SchemaError', () => Effect.succeed(refused(400, malformed)))),
)

export const CatalogRoute = HttpRouter.add('GET', catalogPath, Effect.map(Targets, ({ size }) => HttpServerResponse.jsonUnsafe({ targets: size }, { headers: { 'cache-control': 'no-store' } })))
