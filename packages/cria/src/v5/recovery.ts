import { Deferred, Effect } from 'effect'
import { Failed, type ExternalRecovery } from '@cria/primitives'
import type { Device, Operation, OperationRequest, State } from '@cria/wire'
import { RecoveryToken, type LocalHold, type Resolution } from './holds.js'
import { stopAndFollow } from './operation.js'
import type { Reply } from './http.js'
import type { Session } from './session.js'

export interface Hold {
  readonly criaDeviceId: string
  readonly kind: 'quarantine' | 'unknown'
  readonly reason: string
  readonly since: number
  readonly token: RecoveryToken
}

export interface Recovered {
  readonly found: string
}

export function holdsOf(session: Session): Effect.Effect<ReadonlyArray<Hold>> {
  return Effect.gen(function* () {
    const received = yield* session.received
    const snapshot = received.state === 'live' ? received.snapshot : received.last

    const quarantined = (snapshot?.devices ?? []).flatMap((device): ReadonlyArray<Hold> =>
      device.quarantine.held
        ? [{ criaDeviceId: device.id, kind: 'quarantine', reason: device.quarantine.reason, since: device.quarantine.since, token: quarantineToken(device) }]
        : [],
    )

    const local = (yield* session.holds.all).map((hold): Hold => ({
      criaDeviceId: hold.deviceId,
      kind: 'unknown',
      reason: hold.reason,
      since: hold.since,
      token: hold.token,
    }))

    return [...quarantined, ...local]
  })
}

export function recover(session: Session, token: RecoveryToken, recovery: ExternalRecovery): Effect.Effect<Recovered, Failed> {
  return Effect.uninterruptible(
    Effect.gen(function* () {
      const snapshot = yield* liveSnapshot(session)
      const hold = (yield* session.holds.all).find(candidate => candidate.token === token)

      if (hold?.pin.kind === 'unknown-admission') return yield* fence(session, hold, hold.pin.request, hold.pin.resolved, recovery.note)

      if (hold?.pin.kind === 'lost-operation') return yield* recoverLost(session, snapshot, hold, hold.pin.operation, recovery.note)

      return yield* recoverQuarantine(session, snapshot, token, recovery.note)
    }),
  )
}

function recoverQuarantine(session: Session, snapshot: State, token: RecoveryToken, note: string): Effect.Effect<Recovered, Failed> {
  return Effect.gen(function* () {
    const device = snapshot.devices.find(candidate => candidate.quarantine.held && quarantineToken(candidate) === token)

    if (!device) return yield* new Failed({ reason: 'rejected', message: 'This hold has changed. Check it again before you recover.' })
    const reply = yield* session.recover(device.id, { instanceId: snapshot.instanceId, bindingId: device.bindingId }, note)

    if (reply.kind === 'answered') return { found: `Cria recovered ${device.name}` }

    return yield* refused(reply)
  })
}

/**
 * Cria's recover mints a new binding even on a domain that is not held
 * (Cria's golden, P11), so a delayed POST with the old binding is then
 * refused `binding-changed`.
 */
function fence(
  session: Session,
  hold: LocalHold,
  request: OperationRequest,
  resolved: Deferred.Deferred<Resolution>,
  note: string,
): Effect.Effect<Recovered, Failed> {
  return Effect.gen(function* () {
    const reply = yield* session.recover(request.deviceId, request, note)

    if (reply.kind === 'refused' && reply.code === 'instance-changed') {
      yield* Deferred.succeed(resolved, { kind: 'restarted' })
      yield* session.holds.clear(hold.token)

      return { found: `Cria restarted, so whether it ran ${request.kind} before is unknown` }
    }

    if (reply.kind === 'refused' && reply.code === 'device-busy') {
      const open = yield* lookedUp(session, request)

      if (!open || open.state === 'settled')
        return yield* new Failed({ reason: 'busy', message: `Another operation is open on ${request.deviceId}. Recover once it ends.` })
      const settled = yield* stopAndFollow(session, open).pipe(Effect.mapError(lost => new Failed({ reason: 'unavailable', message: lost.message })))

      yield* Deferred.succeed(resolved, { kind: 'found', operation: open })

      if (settled.outcome.kind === 'uncertain')
        return yield* new Failed({ reason: 'blocked', message: `The stop was not confirmed after you checked: ${settled.outcome.message}. Check again and recover.` })

      return yield* fence(session, hold, request, resolved, note)
    }

    if (reply.kind !== 'answered' && !(reply.kind === 'refused' && reply.code === 'binding-changed')) return yield* refused(reply)
    const ran = yield* lookedUp(session, request)

    if (!ran) {
      yield* Deferred.succeed(resolved, { kind: 'fenced' })
      yield* session.holds.clear(hold.token)

      return { found: `Cria never admitted ${request.kind}` }
    }

    const settled = yield* session.settled(ran).pipe(Effect.mapError(lost => new Failed({ reason: 'unavailable', message: lost.message })))

    yield* Deferred.succeed(resolved, { kind: 'found', operation: ran })
    yield* session.holds.clear(hold.token)

    return { found: `Cria had run ${request.kind}: ${settled.outcome.kind}` }
  })
}

function recoverLost(session: Session, snapshot: State, hold: LocalHold, operation: Operation, note: string): Effect.Effect<Recovered, Failed> {
  return Effect.gen(function* () {
    if (snapshot.instanceId !== operation.instanceId) {
      yield* session.holds.clear(hold.token)

      return { found: `Cria restarted, so what ${operation.kind} did is unknown` }
    }

    // Every open operation is listed, so one that is not has settled.
    const listed = snapshot.operations.find(candidate => candidate.id === operation.id)

    if (listed && listed.state !== 'settled') {
      const settled = yield* stopAndFollow(session, listed).pipe(Effect.mapError(lost => new Failed({ reason: 'unavailable', message: lost.message })))

      if (settled.outcome.kind === 'uncertain')
        return yield* new Failed({ reason: 'blocked', message: `The stop was not confirmed after you checked: ${settled.outcome.message}. Check again and recover.` })
    }

    const reply = yield* session.recover(operation.deviceId, operation, note)

    if (reply.kind !== 'answered' && !(reply.kind === 'refused' && reply.code === 'binding-changed')) return yield* refused(reply)
    yield* session.holds.clear(hold.token)

    return { found: `Cria recovered ${operation.deviceId} after ${operation.kind}` }
  })
}

/** A quarantine is pinned by its domain's binding, so a token from before a recovery is stale. */
function quarantineToken(device: Device): RecoveryToken {
  return RecoveryToken(device.bindingId)
}

function liveSnapshot(session: Session): Effect.Effect<State, Failed> {
  return Effect.gen(function* () {
    const received = yield* session.received

    if (received.state === 'interrupted')
      return yield* new Failed({ reason: 'unavailable', message: `Cria's state is interrupted: ${received.message}. Recover once it is back.` })

    return received.snapshot
  })
}

function lookedUp(session: Session, request: OperationRequest): Effect.Effect<Operation | undefined, Failed> {
  return Effect.gen(function* () {
    const looked = yield* session.lookup(request.instanceId, request.requestId)

    if (looked.kind === 'unknown') return yield* new Failed({ reason: 'unavailable', message: `Cria did not answer the lookup: ${looked.message}` })

    return looked.kind === 'found' ? looked.operation : undefined
  })
}

function refused(reply: Exclude<Reply<Device>, { readonly kind: 'answered' }>): Effect.Effect<never, Failed> {
  if (reply.kind === 'lost')
    return Effect.fail(new Failed({ reason: 'unavailable', message: `Cria did not answer the recovery: ${reply.message}. The hold shows whether it took effect.` }))

  if (reply.code === 'device-busy') return Effect.fail(new Failed({ reason: 'busy', message: reply.message }))

  if (reply.code === 'binding-changed' || reply.code === 'instance-changed')
    return Effect.fail(new Failed({ reason: 'rejected', message: 'This hold has changed. Check it again before you recover.' }))

  return Effect.fail(new Failed({ reason: 'rejected', message: reply.message }))
}
