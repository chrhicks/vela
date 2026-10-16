import { Brand, Deferred, Effect, Ref } from 'effect'
import type { DeviceId, FailureDomain, Operation, OperationRequest } from '@cria/wire'

export type RecoveryToken = string & Brand.Brand<'RecoveryToken'>

export const RecoveryToken = Brand.nominal<RecoveryToken>()

export type Resolution =
  | { readonly kind: 'fenced' }
  | { readonly kind: 'found'; readonly operation: Operation }
  | { readonly kind: 'restarted' }

export type Pin =
  | { readonly kind: 'unknown-admission'; readonly request: OperationRequest; readonly resolved: Deferred.Deferred<Resolution> }
  | { readonly kind: 'lost-operation'; readonly operation: Operation }

export interface LocalHold {
  readonly token: RecoveryToken
  readonly deviceId: DeviceId
  readonly failureDomain: FailureDomain
  readonly reason: string
  readonly since: number
  readonly pin: Pin
}

export interface LocalHolds {
  readonly all: Effect.Effect<ReadonlyArray<LocalHold>>
  readonly add: (hold: Omit<LocalHold, 'token' | 'since'>) => Effect.Effect<RecoveryToken>
  readonly clear: (token: RecoveryToken) => Effect.Effect<void>
}

export function makeLocalHolds(): Effect.Effect<LocalHolds> {
  return Effect.gen(function* () {
    const held = yield* Ref.make<ReadonlyArray<LocalHold>>([])

    return {
      all: Ref.get(held),
      add: hold =>
        Effect.gen(function* () {
          const token = RecoveryToken(crypto.randomUUID())

          yield* Ref.update(held, holds => [...holds, { ...hold, token, since: Date.now() }])

          return token
        }),
      clear: token => Ref.update(held, holds => holds.filter(hold => hold.token !== token)),
    }
  })
}
