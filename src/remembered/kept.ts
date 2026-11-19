import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Data, Effect, Schema } from 'effect'
import { CoolerAtStart } from '../../state/remembered.ts'
import { nothingRemembered, type Remembered } from './remembered.ts'

export class RememberedUnreadable extends Data.TaggedError('RememberedUnreadable')<{ readonly path: string; readonly reason: string }> {}

export class RememberedUnwritable extends Data.TaggedError('RememberedUnwritable')<{ readonly path: string; readonly reason: string }> {}

const Kept = Schema.Struct({
  lastLight: Schema.NullOr(Schema.Struct({ exposureSeconds: Schema.Finite, frames: Schema.NullOr(Schema.Finite), at: Schema.Finite })),
  cameraAngle: Schema.NullOr(Schema.Struct({ degrees: Schema.Finite, at: Schema.Finite })),
  centres: Schema.Array(Schema.Struct({ run: Schema.String, raDegrees: Schema.Finite, decDegrees: Schema.Finite, at: Schema.Finite, reached: Schema.Boolean })),
  camera: Schema.optionalKey(Schema.NullOr(Schema.Struct({ on: Schema.NullOr(Schema.Boolean), setpoint: Schema.NullOr(Schema.Finite), sensorCelsius: Schema.NullOr(Schema.Finite), wrote: Schema.Finite }))),
  targetCoolers: Schema.optionalKey(Schema.Array(Schema.Struct({ target: Schema.String, ...CoolerAtStart.fields }))),
  lastCooler: Schema.optionalKey(Schema.NullOr(CoolerAtStart)),
})

const decodeKept = Schema.decodeUnknownEffect(Schema.fromJsonString(Kept))

const reasonOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

const keptOf = ({ lastLight, cameraAngle, centres, camera, targetCoolers, lastCooler }: Remembered): typeof Kept.Type => ({
  lastLight: lastLight === undefined ? null : { exposureSeconds: lastLight.exposureSeconds, frames: lastLight.frames ?? null, at: lastLight.at },
  cameraAngle: cameraAngle ?? null,
  centres,
  camera: camera === undefined ? null : { on: camera.on ?? null, setpoint: camera.setpoint ?? null, sensorCelsius: camera.sensorCelsius ?? null, wrote: camera.wrote },
  targetCoolers,
  lastCooler: lastCooler ?? null,
})

const rememberedOf = ({ lastLight, cameraAngle, centres, camera, targetCoolers, lastCooler }: typeof Kept.Type): Remembered => ({
  lastLight: lastLight === null ? undefined : { exposureSeconds: lastLight.exposureSeconds, frames: lastLight.frames ?? undefined, at: lastLight.at },
  cameraAngle: cameraAngle ?? undefined,
  centres,
  camera: camera === undefined || camera === null ? undefined : { on: camera.on ?? undefined, setpoint: camera.setpoint ?? undefined, sensorCelsius: camera.sensorCelsius ?? undefined, wrote: camera.wrote },
  targetCoolers: targetCoolers ?? [],
  lastCooler: lastCooler ?? undefined,
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
