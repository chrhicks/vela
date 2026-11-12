import { Clock, Context, Effect, Layer, Schema } from 'effect'

export const StartToken = Schema.String.pipe(Schema.brand('StartToken'))

export type StartToken = typeof StartToken.Type

export class ServiceStart extends Context.Service<ServiceStart, { readonly token: StartToken }>()('vela/ServiceStart') {}

export const ServiceStartNow = Layer.effect(
  ServiceStart,
  Effect.map(Clock.currentTimeMillis, at => ({ token: StartToken.make(String(at)) })),
)
