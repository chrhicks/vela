import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Data, Effect, Schema } from 'effect'
import { nothingRemembered, type Remembered } from './remembered.ts'

export class RememberedUnreadable extends Data.TaggedError('RememberedUnreadable')<{ readonly path: string; readonly reason: string }> {}

export class RememberedUnwritable extends Data.TaggedError('RememberedUnwritable')<{ readonly path: string; readonly reason: string }> {}

const Kept = Schema.Struct({
  lastLight: Schema.NullOr(Schema.Struct({ exposureSeconds: Schema.Finite, frames: Schema.NullOr(Schema.Finite), at: Schema.Finite })),
  cameraAngle: Schema.NullOr(Schema.Struct({ degrees: Schema.Finite, at: Schema.Finite })),
  centres: Schema.Array(Schema.Struct({ run: Schema.String, raDegrees: Schema.Finite, decDegrees: Schema.Finite, at: Schema.Finite, reached: Schema.Boolean })),
})

const decodeKept = Schema.decodeUnknownEffect(Schema.fromJsonString(Kept))

const reasonOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

const keptOf = ({ lastLight, cameraAngle, centres }: Remembered): typeof Kept.Type => ({
  lastLight: lastLight === undefined ? null : { exposureSeconds: lastLight.exposureSeconds, frames: lastLight.frames ?? null, at: lastLight.at },
  cameraAngle: cameraAngle ?? null,
  centres,
})

const rememberedOf = ({ lastLight, cameraAngle, centres }: typeof Kept.Type): Remembered => ({
  lastLight: lastLight === null ? undefined : { exposureSeconds: lastLight.exposureSeconds, frames: lastLight.frames ?? undefined, at: lastLight.at },
  cameraAngle: cameraAngle ?? undefined,
  centres,
})

const written = (path: string) => Effect.promise(() => stat(path).then(() => true, () => false))

export const readKept = (path: string): Effect.Effect<Remembered, RememberedUnreadable> =>
  Effect.flatMap(written(path), found =>
    found
      ? Effect.tryPromise({ try: () => readFile(path, 'utf8'), catch: cause => new RememberedUnreadable({ path, reason: reasonOf(cause) }) }).pipe(
          Effect.flatMap(text => decodeKept(text).pipe(Effect.mapError(error => new RememberedUnreadable({ path, reason: error.message })))),
          Effect.map(rememberedOf),
        )
      : Effect.succeed(nothingRemembered),
  )

export const keep = (path: string, remembered: Remembered): Effect.Effect<void, RememberedUnwritable> =>
  Effect.tryPromise({
    try: async () => {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(`${path}.part`, JSON.stringify(keptOf(remembered)))
      await rename(`${path}.part`, path)
    },
    catch: cause => new RememberedUnwritable({ path, reason: reasonOf(cause) }),
  })
