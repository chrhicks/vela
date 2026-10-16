import { createHash } from 'node:crypto'
import { Effect, Exit, Option, Schedule, Schema, type Scope, Stream, SubscriptionRef } from 'effect'
import { Failed, Uncertain } from '@cria/primitives'
import {
  Device,
  Operation,
  State,
  type BindingId,
  type DeviceId,
  type Image,
  type InstanceId,
  type OperationRequest,
  type RequestId,
} from '@cria/wire'
import { makeLocalHolds, type LocalHolds } from './holds.js'
import { download, request, type CriaConnection, type Reply } from './http.js'

export type Received =
  | { readonly state: 'live'; readonly snapshot: State; readonly receivedAt: number }
  | { readonly state: 'interrupted'; readonly last: State | null; readonly since: number; readonly message: string }

export type SettledOperation = Extract<Operation, { readonly state: 'settled' }>

/** A lookup's `missing` alone does not prove the request was never admitted: a POST still in flight can land after it. */
export type Looked =
  | { readonly kind: 'found'; readonly operation: Operation }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unknown'; readonly message: string }

export interface Session {
  readonly received: Effect.Effect<Received>
  readonly holds: LocalHolds
  readonly post: (operation: OperationRequest) => Effect.Effect<Reply<Operation>>
  readonly lookup: (instanceId: InstanceId, requestId: RequestId) => Effect.Effect<Looked>
  /** Sent again every 500 ms until a 2xx, which only acknowledges it. A 404 or 410 also ends it: Cria holds nothing left to cancel. */
  readonly cancel: (operation: Operation) => Effect.Effect<void>
  /**
   * No Vela deadline while snapshots arrive: Cria bounds each kind itself, and
   * a mount stop can take 20 s. Uncertain once Cria restarts, or its stream
   * stays away for `reconnectWithin`.
   */
  readonly settled: (operation: Operation) => Effect.Effect<SettledOperation, Uncertain>
  readonly recover: (deviceId: DeviceId, pinned: { readonly instanceId: InstanceId; readonly bindingId: BindingId }, note: string) => Effect.Effect<Reply<Device>>
  readonly original: (image: Image) => Effect.Effect<Uint8Array | 'gone', Failed>
}

/** Snapshots arrive at least once a second (SPEC "Event stream"), so three silent seconds mean the stream is broken. */
const cadenceLostAfter = 3_000

const reconnectEvery = '1 second'

const cancelEvery = '500 millis'

const reconnectWithin = 30_000

export function openSession(connection: CriaConnection): Effect.Effect<Session, never, Scope.Scope> {
  return Effect.gen(function* () {
    const received = yield* SubscriptionRef.make<Received>({
      state: 'interrupted',
      last: null,
      since: Date.now(),
      message: 'Connecting to Cria',
    })

    const holds = yield* makeLocalHolds()

    const nextChange = (current: Received) =>
      SubscriptionRef.changes(received).pipe(
        Stream.filter(latest => latest !== current),
        Stream.runHead,
        Effect.asVoid,
      )

    yield* Effect.forkScoped(Effect.forever(subscribe(connection, received)))
    yield* Effect.forkScoped(Effect.forever(watchCadence(received, nextChange)))

    const lookup = (instanceId: InstanceId, requestId: RequestId) =>
      request(connection, 'GET', `/v2/requests/${instanceId}/${encodeURIComponent(requestId)}`, Operation).pipe(
        Effect.map((reply): Looked => {
          if (reply.kind === 'answered') return { kind: 'found', operation: reply.body }

          if (reply.kind === 'refused' && reply.code === 'not-found') return { kind: 'missing' }

          return { kind: 'unknown', message: reply.message }
        }),
      )

    const cancel = (operation: Operation) =>
      request(connection, 'POST', `/v2/operations/${operation.id}/cancel`, Operation).pipe(
        Effect.map(reply => reply.kind === 'answered' || (reply.kind === 'refused' && (reply.code === 'not-found' || reply.code === 'result-expired'))),
        Effect.repeat({ until: ended => ended, schedule: Schedule.spaced(cancelEvery) }),
        Effect.asVoid,
      )

    const settled = (operation: Operation): Effect.Effect<SettledOperation, Uncertain> =>
      Effect.gen(function* () {
        if (operation.state === 'settled') return operation

        while (true) {
          const current = yield* SubscriptionRef.get(received)

          if (current.state === 'interrupted') {
            const left = current.since + reconnectWithin - Date.now()

            if (left <= 0)
              return yield* new Uncertain({
                reason: 'connection-lost',
                message: `Cria's state stayed away while ${operation.kind} was running: ${current.message}`,
              })

            yield* Effect.timeoutOption(nextChange(current), left)
            continue
          }

          if (current.snapshot.instanceId !== operation.instanceId)
            return yield* new Uncertain({ reason: 'connection-lost', message: `Cria restarted while ${operation.kind} was running` })
          let seen = current.snapshot.operations.find(candidate => candidate.id === operation.id)

          // A snapshot built before Cria accepted the operation cannot list it yet.
          if (!seen && current.snapshot.generatedAt >= operation.acceptedAt) seen = yield* fetchOperation(operation)

          if (seen?.state === 'settled') return seen
          yield* nextChange(current)
        }
      })

    /** A snapshot lists only the newest settled operations, so one missing from it is read directly. */
    const fetchOperation = (operation: Operation) =>
      request(connection, 'GET', `/v2/operations/${operation.id}`, Operation).pipe(
        Effect.flatMap(reply => {
          if (reply.kind === 'answered') return Effect.succeed(reply.body)

          if (reply.kind === 'lost') return Effect.succeed(undefined)

          return Effect.fail(new Uncertain({ reason: 'unexpected-error', message: `Cria no longer holds ${operation.kind}: ${reply.message}` }))
        }),
      )

    // Vela must read the new binding before it commands again (SPEC "Recovery"), and Cria sends it within 250 ms.
    const recover = (deviceId: DeviceId, pinned: { readonly instanceId: InstanceId; readonly bindingId: BindingId }, note: string) =>
      Effect.gen(function* () {
        const recovery = { instanceId: pinned.instanceId, bindingId: pinned.bindingId, externalRecoveryConfirmed: true, note } as const
        const reply = yield* request(connection, 'POST', `/v2/devices/${deviceId}/recover`, Device, recovery)

        if (reply.kind === 'answered') {
          const rebound = (current: Received) =>
            current.state === 'live' && current.snapshot.devices.some(device => device.id === deviceId && device.bindingId !== pinned.bindingId)

          yield* Effect.timeoutOption(SubscriptionRef.changes(received).pipe(Stream.filter(rebound), Stream.runHead), cadenceLostAfter)
        }

        return reply
      })

    const original = (image: Image) => {
      const intact = (bytes: Uint8Array) =>
        bytes.byteLength === image.original.bytes && createHash('sha256').update(bytes).digest('hex') === image.sha256

      return download(connection, image.original.url).pipe(
        Effect.repeat({
          until: reply => reply.kind === 'refused' || (reply.kind === 'answered' && intact(reply.body)),
          times: 2,
          schedule: Schedule.spaced('500 millis'),
        }),
        Effect.flatMap((reply): Effect.Effect<Uint8Array | 'gone', Failed> => {
          if (reply.kind === 'refused' && reply.code === 'image-gone') return Effect.succeed('gone')

          if (reply.kind === 'answered' && intact(reply.body)) return Effect.succeed(reply.body)

          const message = reply.kind === 'answered' ? `image ${image.id} arrived damaged` : reply.message

          return Effect.fail(new Failed({ reason: 'unavailable', message: `Could not download the image: ${message}` }))
        }),
      )
    }

    return {
      received: SubscriptionRef.get(received),
      holds,
      post: operation => request(connection, 'POST', '/v2/operations', Operation, operation),
      lookup,
      cancel,
      settled,
      recover,
      original,
    }
  })
}

function subscribe(connection: CriaConnection, received: SubscriptionRef.SubscriptionRef<Received>) {
  const ended = (message: string) =>
    SubscriptionRef.update(received, current => (current.state === 'interrupted' ? { ...current, message } : current))

  const connected = Effect.gen(function* () {
    const aborter = yield* Effect.acquireRelease(
      Effect.sync(() => new AbortController()),
      controller => Effect.sync(() => controller.abort()),
    )

    const headers = new Headers({ accept: 'text/event-stream' })

    if (connection.token !== undefined) headers.set('authorization', `Bearer ${connection.token}`)
    const response = yield* attempt(() => connection.fetch(new URL('/v2/events', connection.origin), { headers, signal: aborter.signal }))

    if (response.status !== 200 || !response.body) return `Cria refused the event stream with ${response.status}`
    const body = response.body

    const reader = yield* Effect.acquireRelease(
      Effect.sync(() => body.getReader()),
      opened => Effect.ignore(attempt(() => opened.cancel())),
    )

    const text = new TextDecoder()
    let buffer = ''

    while (true) {
      const read = yield* Effect.timeoutOption(attempt(() => reader.read()), cadenceLostAfter)

      if (Option.isNone(read)) return `Cria sent no state for ${cadenceLostAfter / 1_000} seconds`

      if (read.value.done) return 'Cria closed the event stream'
      const events = takeEvents(buffer + text.decode(read.value.value, { stream: true }))

      buffer = events.rest

      for (const data of events.states) {
        const decoded = Schema.decodeUnknownExit(Schema.fromJsonString(State))(data)

        if (Exit.isFailure(decoded)) return 'Cria sent a state that is not protocol 5'
        yield* SubscriptionRef.set(received, { state: 'live', snapshot: decoded.value, receivedAt: Date.now() })
      }
    }
  })

  return Effect.scoped(connected).pipe(
    Effect.catch(message => Effect.succeed(`Cria is unreachable: ${message}`)),
    Effect.flatMap(ended),
    Effect.andThen(Effect.sleep(reconnectEvery)),
  )
}

function watchCadence(received: SubscriptionRef.SubscriptionRef<Received>, nextChange: (current: Received) => Effect.Effect<void>) {
  return Effect.gen(function* () {
    const current = yield* SubscriptionRef.get(received)

    if (current.state === 'interrupted') return yield* nextChange(current)
    const changed = yield* Effect.timeoutOption(nextChange(current), Math.max(0, current.receivedAt + cadenceLostAfter - Date.now()))

    if (Option.isSome(changed)) return
    yield* SubscriptionRef.update(received, (latest): Received =>
      latest === current
        ? {
            state: 'interrupted',
            last: current.snapshot,
            since: current.receivedAt,
            message: `Cria sent no state for ${cadenceLostAfter / 1_000} seconds`,
          }
        : latest,
    )
  })
}

function attempt<A>(promise: () => Promise<A>): Effect.Effect<A, string> {
  return Effect.tryPromise({ try: promise, catch: error => (error instanceof Error ? error.message : String(error)) })
}

interface Taken {
  readonly states: ReadonlyArray<string>
  readonly rest: string
}

function takeEvents(buffer: string): Taken {
  const blocks = buffer.replaceAll('\r\n', '\n').split('\n\n')
  const rest = blocks.pop() ?? ''

  const states = blocks.flatMap(block => {
    const lines = block.split('\n')
    const event = lines.find(line => line.startsWith('event:'))?.slice('event:'.length).trim() ?? 'message'
    const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice('data:'.length).replace(/^ /, ''))

    return event === 'state' && data.length > 0 ? [data.join('\n')] : []
  })

  return { states, rest }
}
