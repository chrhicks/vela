import { Context, Data, Effect, Layer, Schema } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

export const Commit = Schema.String.check(Schema.isPattern(/^[0-9a-f]{7,40}$/)).pipe(Schema.brand('Commit'))

export type Commit = typeof Commit.Type

export class VersionUnknown extends Data.TaggedError('VersionUnknown')<{ readonly checkout: string; readonly output: string }> {}

export class ServiceVersion extends Context.Service<ServiceVersion, { readonly commit: Commit }>()('vela/ServiceVersion') {}

const decodeCommit = Schema.decodeUnknownEffect(Commit)

export const serviceVersionOf = (checkout: string) =>
  Layer.effect(
    ServiceVersion,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const output = (yield* spawner.string(ChildProcess.make('git', ['rev-parse', '--short', 'HEAD'], { cwd: checkout }))).trim()
      const commit = yield* decodeCommit(output).pipe(Effect.mapError(() => new VersionUnknown({ checkout, output })))

      return { commit }
    }),
  )
