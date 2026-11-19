import { readFile, stat } from 'node:fs/promises'
import { Data, Effect, Schema } from 'effect'
import { Horizon, noHorizon } from './horizon.ts'

export class HorizonUnreadable extends Data.TaggedError('HorizonUnreadable')<{ readonly path: string; readonly reason: string }> {}

const decodeHorizon = Schema.decodeUnknownEffect(Schema.fromJsonString(Horizon))

const reasonOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

const written = (path: string) => Effect.promise(() => stat(path).then(() => true, () => false))

export const readHorizon = (path: string): Effect.Effect<Horizon, HorizonUnreadable> =>
  Effect.flatMap(written(path), found =>
    found
      ? Effect.tryPromise({ try: () => readFile(path, 'utf8'), catch: cause => new HorizonUnreadable({ path, reason: reasonOf(cause) }) }).pipe(
          Effect.flatMap(text => decodeHorizon(text).pipe(Effect.mapError(error => new HorizonUnreadable({ path, reason: error.message })))),
        )
      : Effect.succeed(noHorizon),
  )

export const loadHorizon = (path: string): Effect.Effect<Horizon> =>
  readHorizon(path).pipe(
    Effect.catchTag('HorizonUnreadable', error =>
      Effect.logWarning(`the horizon could not be read from ${error.path}: ${error.reason}. Every direction is treated as unknown`).pipe(Effect.as(noHorizon)),
    ),
  )
