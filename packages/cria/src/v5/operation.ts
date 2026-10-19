import { Cause, Deferred, Effect, Exit, Fiber, Option, Schedule } from 'effect'
import type { CaptureProvenance } from '@vela/equipment'
import { Failed, Stopped, Uncertain, type Ending, type FailedReason } from '@cria/primitives'
import {
  RequestId,
  type Command,
  type CommandKind,
  type Device,
  type ErrorCode,
  type HaltCommand,
  type HaltKind,
  type Image,
  type Operation,
  type OperationRequest,
  type OperationResult,
  type ParamsOf,
  type State,
} from '@cria/wire'
import type { Resolution } from './holds.js'
import type { Reply } from './http.js'
import type { Session, SettledOperation } from './session.js'

export interface Target {
  readonly criaDeviceId: string
  readonly expectedName: string
}

export type Motion = Exclude<Command, HaltCommand>

export type Exposed =
  | { readonly kind: 'frame'; readonly image: Image; readonly bytes: Uint8Array }
  | { readonly kind: 'lost'; readonly message: string }

/** Called as an operation's ids become known: its request ID just before it is sent, then its operation ID. */
export type Observe = (provenance: CaptureProvenance) => void

const onStop = {
  capture: 'cancel',
  'camera-configure': 'finish',
  cooling: 'finish',
  'focuser-move': 'cancel',
  'mount-slew': 'cancel',
  'mount-tracking': 'finish',
  'mount-axis': 'cancel',
  'mount-rotate': 'cancel',
  'mount-home': 'cancel',
  'mount-park': 'cancel',
  'mount-unpark': 'finish',
  'switch-set': 'finish',
  'device-connect': 'finish',
} as const satisfies Record<Exclude<CommandKind, HaltKind>, 'cancel' | 'finish'>

type Admission =
  | { readonly kind: 'admitted'; readonly operation: Operation }
  | { readonly kind: 'refused'; readonly failed: Failed }
  | { readonly kind: 'unknown'; readonly message: string }

const refusedAs = {
  'request-error': 'invalid',
  unauthorized: 'rejected',
  'origin-rejected': 'rejected',
  'commands-disabled': 'unavailable',
  'not-found': 'invalid',
  'request-conflict': 'invalid',
  'instance-changed': 'rejected',
  'binding-changed': 'rejected',
  'device-blocked': 'blocked',
  'device-busy': 'busy',
  'result-expired': 'rejected',
  'image-gone': 'invalid',
  'request-too-large': 'invalid',
  'too-many-subscribers': 'unavailable',
  'internal-error': 'maybe-admitted',
} as const satisfies Record<ErrorCode, FailedReason | 'maybe-admitted'>

const lookupEvery = '1 second'

/** Cria's own bound on a stop (SPEC "Stopping the mount"). */
const stopWithin = '20 seconds'

/** Whether a Stop reached this fiber. Effect keeps the interrupt recorded, so once true it stays true. */
const stopRequested = Effect.exit(Effect.interruptible(Effect.void)).pipe(Effect.map(Exit.isFailure))

/**
 * Cria's settled Outcome is the ending, including `stopped` for a short motion
 * a cancel caught completing. An outer `stoppable` from @cria/primitives would
 * replace it with Stopped as soon as its own halt succeeded. Uninterruptible
 * except while it follows an operation a Stop cancels.
 */
export function remoteOperation(
  session: Session,
  target: Target,
  command: Motion,
  observe?: Observe,
): Effect.Effect<OperationResult, Ending> {
  const cancelsOnStop = onStop[command.kind] === 'cancel'

  return Effect.uninterruptible(
    Effect.gen(function* () {
      if (cancelsOnStop && (yield* stopRequested)) return yield* new Stopped()
      const received = yield* session.received

      if (received.state === 'interrupted')
        return yield* new Failed({ reason: 'unavailable', message: `Cria's state is interrupted: ${received.message}` })
      const { request, device } = yield* requestFor(received.snapshot, target, command)
      const held = (yield* session.holds.all).find(hold => hold.failureDomain === device.failureDomain)

      if (held) return yield* new Failed({ reason: 'blocked', message: held.reason })
      const requested = { requestId: request.requestId, operationId: null, imageId: null }

      observe?.(requested)
      const operation = yield* admit(session, request, device)

      observe?.({ ...requested, operationId: operation.id })
      const settled = yield* follow(session, operation, cancelsOnStop)

      return yield* outcomeOf(settled)
    }),
  )
}

export function capture(
  session: Session,
  target: Target,
  parameters: ParamsOf<'capture'>,
  observe?: Observe,
): Effect.Effect<Exposed, Ending> {
  return Effect.uninterruptible(
    Effect.gen(function* () {
      let operationSeen: CaptureProvenance | undefined

      const { image } = yield* remoteOperation(session, target, { kind: 'capture', parameters }, seen => {
        operationSeen = seen
        observe?.(seen)
      })

      if (!image) return yield* new Failed({ reason: 'unavailable', message: 'Cria confirmed the capture without an image' })

      if (operationSeen) observe?.({ ...operationSeen, imageId: image.id })
      const bytes = yield* session.original(image)

      if (bytes === 'gone') return { kind: 'lost', message: `Cria dropped image ${image.id} before Vela fetched it` }

      return { kind: 'frame', image, bytes }
    }),
  )
}

/**
 * Stop motion now, held or busy: Cria admits a halt on a held domain, and on
 * a busy one it waits while Cria stops the running operation (SPEC "Halts,
 * stops and cancel"). A stop can only stop motion, so a lost reply is sent
 * again with the same request ID. A halt is followed to its ending, never
 * cancelled. It uses the newest snapshot even while the stream is
 * interrupted: Cria refuses a stale instance or binding itself.
 */
export function halt(session: Session, target: Target, kind: HaltKind): Effect.Effect<void, Ending> {
  return Effect.uninterruptible(
    Effect.gen(function* () {
      const received = yield* session.received
      const snapshot = received.state === 'live' ? received.snapshot : received.last

      if (!snapshot) return yield* new Failed({ reason: 'unavailable', message: 'Cria has not sent its state yet' })
      const { request, device } = yield* requestFor(snapshot, target, { kind, parameters: {} })

      const answer = yield* Effect.timeoutOption(
        session.post(request).pipe(
          Effect.map(admissionOf),
          Effect.repeat({ until: admission => admission.kind !== 'unknown', schedule: Schedule.spaced('500 millis') }),
        ),
        stopWithin,
      )

      if (Option.isNone(answer)) {
        yield* holdUnknown(session, request, device, yield* Deferred.make<Resolution>())

        return yield* new Uncertain({ reason: 'no-acknowledgement', message: `Cria did not answer ${kind} within ${stopWithin}` })
      }

      const admission = answer.value

      if (admission.kind === 'refused') return yield* admission.failed

      if (admission.kind === 'admitted') yield* outcomeOf(yield* follow(session, admission.operation, false))
    }),
  )
}

export function stopAndFollow(session: Session, operation: Operation): Effect.Effect<SettledOperation, Uncertain> {
  return Effect.gen(function* () {
    const following = yield* Effect.forkChild(session.settled(operation))

    yield* Effect.raceFirst(session.cancel(operation), Fiber.await(following))

    return yield* Fiber.join(following)
  })
}

function requestFor(
  snapshot: State,
  target: Target,
  command: Command,
): Effect.Effect<{ readonly request: OperationRequest; readonly device: Device }, Failed> {
  const device = snapshot.devices.find(candidate => candidate.id === target.criaDeviceId)

  if (!device) return Effect.fail(new Failed({ reason: 'unavailable', message: `Cria does not report ${target.criaDeviceId}` }))

  if (device.name !== target.expectedName)
    return Effect.fail(new Failed({ reason: 'rejected', message: `Cria's ${device.id} is ${device.name}, not ${target.expectedName}` }))

  const request: OperationRequest = {
    instanceId: snapshot.instanceId,
    requestId: RequestId.make(crypto.randomUUID()),
    deviceId: device.id,
    bindingId: device.bindingId,
    expectedName: device.name,
    ...command,
  }

  return Effect.succeed({ request, device })
}

function admit(session: Session, request: OperationRequest, device: Device): Effect.Effect<Operation, Ending> {
  return Effect.gen(function* () {
    const admission = admissionOf(yield* session.post(request))

    if (admission.kind === 'admitted') return admission.operation

    if (admission.kind === 'refused') return yield* admission.failed

    const looked = yield* session.lookup(request.instanceId, request.requestId).pipe(
      Effect.repeat({ until: answer => answer.kind !== 'unknown', times: 2, schedule: Schedule.spaced('500 millis') }),
    )

    if (looked.kind === 'found') return looked.operation

    return yield* awaitAdmission(session, request, device)
  })
}

function awaitAdmission(session: Session, request: OperationRequest, device: Device): Effect.Effect<Operation, Ending> {
  return Effect.gen(function* () {
    const resolved = yield* Deferred.make<Resolution>()

    yield* holdUnknown(session, request, device, resolved)

    while (true) {
      const resolution = yield* Effect.timeoutOption(Deferred.await(resolved), lookupEvery)

      if (Option.isSome(resolution)) return yield* resumeAfterRecovery(request, resolution.value)
      const received = yield* session.received

      if (received.state === 'live' && received.snapshot.instanceId !== request.instanceId)
        return yield* new Uncertain({ reason: 'connection-lost', message: `Cria restarted before Vela learned whether it admitted ${request.kind}` })
      const looked = yield* session.lookup(request.instanceId, request.requestId)

      if (looked.kind === 'found') return looked.operation
    }
  })
}

function resumeAfterRecovery(request: OperationRequest, resolution: Resolution): Effect.Effect<Operation, Ending> {
  return Effect.gen(function* () {
    switch (resolution.kind) {
      case 'found':
        return resolution.operation
      case 'fenced':
        if (yield* stopRequested) return yield* new Stopped()

        return yield* new Failed({ reason: 'unavailable', message: `Cria never admitted ${request.kind}; recovery fenced the request` })
      case 'restarted':
        return yield* new Uncertain({ reason: 'connection-lost', message: `Cria restarted before Vela learned whether it admitted ${request.kind}` })
    }
  })
}

function follow(session: Session, operation: Operation, cancelsOnStop: boolean): Effect.Effect<SettledOperation, Uncertain> {
  const followed = Effect.gen(function* () {
    if (!cancelsOnStop) return yield* session.settled(operation)
    const waited = yield* Effect.exit(Effect.interruptible(session.settled(operation)))

    if (Exit.isSuccess(waited)) return waited.value

    if (!Cause.hasInterruptsOnly(waited.cause)) return yield* Effect.failCause(waited.cause)

    return yield* stopAndFollow(session, operation)
  })

  return followed.pipe(
    Effect.tapError(lost =>
      session.holds.add({
        deviceId: operation.deviceId,
        failureDomain: operation.failureDomain,
        reason: `Vela lost track of ${operation.kind}: ${lost.message}. Check the device and recover it.`,
        pin: { kind: 'lost-operation', operation },
      }),
    ),
  )
}

function holdUnknown(session: Session, request: OperationRequest, device: Device, resolved: Deferred.Deferred<Resolution>) {
  return session.holds.add({
    deviceId: device.id,
    failureDomain: device.failureDomain,
    reason: `Cria has not shown whether it admitted ${request.kind}. Check the ${device.kind} and recover it.`,
    pin: { kind: 'unknown-admission', request, resolved },
  })
}

function admissionOf(reply: Reply<Operation>): Admission {
  if (reply.kind === 'answered') return { kind: 'admitted', operation: reply.body }
  const reason = reply.kind === 'refused' ? refusedAs[reply.code] : 'maybe-admitted'

  if (reply.kind === 'refused' && reason !== 'maybe-admitted') return { kind: 'refused', failed: new Failed({ reason, message: reply.message }) }

  return { kind: 'unknown', message: reply.message }
}

function outcomeOf(operation: SettledOperation): Effect.Effect<OperationResult, Ending> {
  switch (operation.outcome.kind) {
    case 'confirmed':
      return Effect.succeed(operation.outcome.value)
    case 'failed':
      return Effect.fail(new Failed({ reason: operation.outcome.reason, message: operation.outcome.message }))
    case 'stopped':
      return Effect.fail(new Stopped())
    case 'uncertain':
      return Effect.fail(new Uncertain({ reason: operation.outcome.reason, message: operation.outcome.message }))
  }
}
