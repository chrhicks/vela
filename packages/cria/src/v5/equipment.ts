import { Effect } from 'effect'
import { Failed, type Ending, type ExternalRecovery } from '@cria/primitives'
import type { HaltKind, OperationResult, ParamsOf } from '@cria/wire'
import type { RecoveryToken } from './holds.js'
import { capture, halt, remoteOperation, type Exposed, type Motion, type Observe, type Target } from './operation.js'
import { holdsOf, recover, type Hold, type Recovered } from './recovery.js'
import type { Received, Session } from './session.js'
import type { LocalWarning } from './warnings.js'

export interface CriaBinding {
  readonly deviceId: string
  readonly criaDeviceId: string
  readonly expectedName: string
}

export type RigWarning = Omit<LocalWarning, 'deviceId'> & { readonly deviceId: string }

export type RigHold = Omit<Hold, 'criaDeviceId'> & { readonly deviceId: string }

export interface CriaEquipment {
  readonly received: Effect.Effect<Received>
  readonly holds: Effect.Effect<ReadonlyArray<RigHold>>
  /** Uncertain endings on a device Cria does not hold. They block nothing. */
  readonly warnings: Effect.Effect<ReadonlyArray<RigWarning>>
  readonly dismissWarning: (deviceId: string) => Effect.Effect<void>
  readonly run: (deviceId: string, command: Motion) => Effect.Effect<OperationResult, Ending>
  readonly capture: (deviceId: string, parameters: ParamsOf<'capture'>, observe?: Observe) => Effect.Effect<Exposed, Ending>
  readonly halt: (deviceId: string, kind: HaltKind) => Effect.Effect<void, Ending>
  readonly recover: (token: RecoveryToken, recovery: ExternalRecovery) => Effect.Effect<Recovered, Failed>
}

export function createCriaEquipment(session: Session, bindings: ReadonlyArray<CriaBinding>): CriaEquipment {
  const bound = (deviceId: string): Effect.Effect<Target, Failed> => {
    const binding = bindings.find(candidate => candidate.deviceId === deviceId)

    if (!binding) return Effect.fail(new Failed({ reason: 'invalid', message: `${deviceId} is not one of this rig's Cria devices` }))

    return Effect.succeed({ criaDeviceId: binding.criaDeviceId, expectedName: binding.expectedName })
  }

  return {
    received: session.received,
    holds: holdsOf(session).pipe(
      Effect.map(holds =>
        holds.flatMap((hold): ReadonlyArray<RigHold> => {
          const binding = bindings.find(candidate => candidate.criaDeviceId === hold.criaDeviceId)

          return binding ? [{ deviceId: binding.deviceId, kind: hold.kind, reason: hold.reason, since: hold.since, token: hold.token }] : []
        }),
      ),
    ),
    warnings: Effect.map(session.warnings.all, warnings =>
      warnings.flatMap((warning): ReadonlyArray<RigWarning> => {
        const binding = bindings.find(candidate => candidate.criaDeviceId === warning.deviceId)

        return binding ? [{ deviceId: binding.deviceId, reason: warning.reason, since: warning.since }] : []
      }),
    ),
    dismissWarning: deviceId => {
      const binding = bindings.find(candidate => candidate.deviceId === deviceId)

      return binding ? session.warnings.clear(binding.criaDeviceId) : Effect.void
    },
    run: (deviceId, command) => Effect.flatMap(bound(deviceId), target => remoteOperation(session, target, command)),
    capture: (deviceId, parameters, observe) => Effect.flatMap(bound(deviceId), target => capture(session, target, parameters, observe)),
    halt: (deviceId, kind) => Effect.flatMap(bound(deviceId), target => halt(session, target, kind)),
    recover: (token, recovery) => recover(session, token, recovery),
  }
}
