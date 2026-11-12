import { Clock, Context, Effect, Layer } from 'effect'
import { StartToken } from '../../state/feed.ts'

export class ServiceStart extends Context.Service<ServiceStart, { readonly token: StartToken }>()('vela/ServiceStart') {}

export const ServiceStartNow = Layer.effect(
  ServiceStart,
  Effect.map(Clock.currentTimeMillis, at => ({ token: StartToken.make(String(at)) })),
)
