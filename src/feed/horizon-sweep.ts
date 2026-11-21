import { Context, Effect } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/http'
import { horizonSweepPath, type HorizonSweep } from '../../state/horizon-sweep.ts'

export class HorizonSweepKept extends Context.Service<HorizonSweepKept, { readonly answer: HorizonSweep }>()('vela/HorizonSweepKept') {}

export const HorizonSweepRoute = HttpRouter.add(
  'GET',
  horizonSweepPath,
  Effect.map(HorizonSweepKept, ({ answer }) => HttpServerResponse.jsonUnsafe(answer, { headers: { 'cache-control': 'no-store' } })),
)
