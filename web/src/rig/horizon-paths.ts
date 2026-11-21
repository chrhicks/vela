import { Effect, Schema } from 'effect'
import { HorizonPaths, horizonPathsPath, targetSeparator } from '../../../state/horizon-night.ts'
import { asked, bodyOf } from './targets.ts'

const reading = (targets: ReadonlyArray<string>, at: number): Effect.Effect<HorizonPaths | undefined> =>
  asked(`${horizonPathsPath}?${new URLSearchParams({ targets: targets.join(targetSeparator), at: new Date(at).toISOString() })}`).pipe(
    Effect.flatMap(response => (response.ok ? bodyOf(response) : Effect.succeed(undefined))),
    Effect.flatMap(body => (body === undefined ? Effect.succeed(undefined) : Schema.decodeUnknownEffect(HorizonPaths)(body))),
    Effect.catchTags({ UnknownError: () => Effect.succeed(undefined), SchemaError: () => Effect.succeed(undefined) }),
  )

export const horizonPaths = (targets: ReadonlyArray<string>, at: number): Promise<HorizonPaths | undefined> => (targets.length === 0 ? Promise.resolve(undefined) : Effect.runPromise(reading(targets, at)))
