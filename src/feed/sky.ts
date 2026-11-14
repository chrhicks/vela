import { Context, Effect } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/http'
import { skyPath, type Sky } from '../../state/sky.ts'

export class SkyNow extends Context.Service<SkyNow, { readonly tonight: Effect.Effect<Sky | null> }>()('vela/SkyNow') {}

export const SkyRoute = HttpRouter.add(
  'GET',
  skyPath,
  Effect.map(Effect.flatMap(SkyNow, sky => sky.tonight), tonight => HttpServerResponse.jsonUnsafe(tonight, { headers: { 'cache-control': 'no-store' } })),
)
