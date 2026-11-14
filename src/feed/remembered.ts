import { Context, Effect } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/http'
import { rememberedPath, type RememberedAnswer } from '../../state/remembered.ts'

export class Recalled extends Context.Service<Recalled, { readonly now: Effect.Effect<RememberedAnswer> }>()('vela/Recalled') {}

export const RememberedRoute = HttpRouter.add(
  'GET',
  rememberedPath,
  Effect.map(Effect.flatMap(Recalled, recalled => recalled.now), answer => HttpServerResponse.jsonUnsafe(answer, { headers: { 'cache-control': 'no-store' } })),
)
