import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Context, Data, Effect, Layer } from 'effect'

export class VersionUnknown extends Data.TaggedError('VersionUnknown')<{ readonly checkout: string; readonly issue: string }> {}

export class ServiceVersion extends Context.Service<ServiceVersion, { readonly commit: string }>()('vela/ServiceVersion') {}

const checkout = fileURLToPath(new URL('../../', import.meta.url))

export const ServiceVersionFromCheckout = Layer.effect(
  ServiceVersion,
  Effect.try({
    try: () => ({ commit: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim() }),
    catch: error => new VersionUnknown({ checkout, issue: String(error) }),
  }),
)
