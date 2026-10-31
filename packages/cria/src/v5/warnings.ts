import { Effect, Ref } from 'effect'

/**
 * An operation on a camera, focuser, weather or switch device ended uncertain. Cria no
 * longer holds such a device, so this is a note for Chris, not a block. It lasts until
 * the next confirmed command on the device or until he dismisses it.
 */
export interface LocalWarning {
  readonly deviceId: string
  readonly reason: string
  readonly since: number
}

export interface LocalWarnings {
  readonly all: Effect.Effect<ReadonlyArray<LocalWarning>>
  readonly note: (deviceId: string, reason: string) => Effect.Effect<void>
  readonly clear: (deviceId: string) => Effect.Effect<void>
}

export function makeLocalWarnings(): Effect.Effect<LocalWarnings> {
  return Effect.gen(function* () {
    const noted = yield* Ref.make<ReadonlyArray<LocalWarning>>([])

    return {
      all: Ref.get(noted),
      note: (deviceId, reason) =>
        Ref.update(noted, warnings => [...warnings.filter(warning => warning.deviceId !== deviceId), { deviceId, reason, since: Date.now() }]),
      clear: deviceId => Ref.update(noted, warnings => warnings.filter(warning => warning.deviceId !== deviceId)),
    }
  })
}
