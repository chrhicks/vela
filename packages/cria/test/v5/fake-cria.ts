/**
 * A protocol 5 Cria in memory, for the client's tests. It serves one rig (a
 * camera, a mount and a focuser, each its own failure domain) as a `fetch`,
 * HTTP and SSE, and answers from its own ledger by the rules of Cria's SPEC at
 * 86624908 ("The ledger" and "The wire (protocol 5)"). Every reply is encoded
 * with @cria/wire, so the fake cannot send a body Cria would not.
 *
 * - Clock: call vi.useFakeTimers() before `new FakeCria()`, then drive the fake
 *   and the client together with vi.advanceTimersByTimeAsync(ms). Every
 *   subscriber gets a snapshot at once, then each second, and at once after
 *   each change. Devices are read again on each second.
 * - Wiring: pass `fetch` and `origin` to the client. `received` lists every
 *   request that reached Cria, in order.
 * - Endings: a capture confirms after its exposure, with an image; any other
 *   kind confirms after `durationMs[kind]` (default 0). A cancel, or a halt
 *   queued behind a motion, stops it `stopMs` later unless it ends first.
 *   `settle(id, outcome)` ends a running operation now with any outcome.
 * - Faults: `dropReply(route)` loses the next reply on a route after applying
 *   it; `delay(route, ms)` makes the next request on a route land later;
 *   `restart()` is a new instance; `dropImage(id)` expires an image;
 *   `reachable = false` fails new requests and quiets open streams.
 * - Call `close()` after each test.
 */
import { createHash, randomUUID } from 'node:crypto'
import { Schema } from 'effect'
import {
  BindingId,
  Device,
  DeviceId,
  ErrorBody,
  FailureDomain,
  Health,
  Image,
  ImageId,
  InstanceId,
  Operation,
  OperationId,
  OperationRequest,
  RecoveryRequest,
  RequestId,
  State,
  commands,
  isHalt,
  protocolVersion,
  type CommandKind,
  type ErrorCode,
} from '@cria/wire'

export type Route = 'health' | 'state' | 'events' | 'submit' | 'operation' | 'cancel' | 'lookup' | 'recover' | 'image'

const routes: ReadonlyArray<readonly [string, RegExp, Route]> = [
  ['GET', /^\/health$/, 'health'],
  ['GET', /^\/v2\/state$/, 'state'],
  ['GET', /^\/v2\/events$/, 'events'],
  ['POST', /^\/v2\/operations$/, 'submit'],
  ['GET', /^\/v2\/operations\/([^/]+)$/, 'operation'],
  ['POST', /^\/v2\/operations\/([^/]+)\/cancel$/, 'cancel'],
  ['GET', /^\/v2\/requests\/([^/]+)\/([^/]+)$/, 'lookup'],
  ['POST', /^\/v2\/devices\/([^/]+)\/recover$/, 'recover'],
  ['GET', /^\/v2\/images\/([^/]+)\/original$/, 'image'],
]

export function routeOf(method: string, path: string): { readonly route: Route; readonly segments: ReadonlyArray<string> } | undefined {
  for (const [routeMethod, pattern, route] of routes) {
    const match = method === routeMethod ? pattern.exec(path) : null

    if (match) return { route, segments: match.slice(1).map(decodeURIComponent) }
  }

  return undefined
}

/** SPEC "Errors": each code has exactly one HTTP status. */
export const statusOf = {
  'request-error': 400,
  unauthorized: 401,
  'origin-rejected': 403,
  'commands-disabled': 403,
  'not-found': 404,
  'request-conflict': 409,
  'instance-changed': 409,
  'binding-changed': 409,
  'device-blocked': 409,
  'device-busy': 409,
  'result-expired': 410,
  'image-gone': 410,
  'request-too-large': 413,
  'too-many-subscribers': 429,
  'internal-error': 500,
} satisfies { readonly [C in ErrorCode]: number }

type Settled = Extract<Operation, { readonly state: 'settled' }>

type Running = Extract<Operation, { readonly state: 'running' }>

export type Ending = Settled['outcome']

/** What one request to the fake carried, in arrival order. */
export interface Received {
  readonly route: Route | undefined
  readonly method: string
  readonly path: string
  readonly body: string | undefined
}

interface Rigged {
  readonly id: DeviceId
  readonly kind: 'camera' | 'mount' | 'focuser'
  readonly name: string
  readonly failureDomain: FailureDomain
}

const rig: ReadonlyArray<Rigged> = [
  { id: DeviceId.make('camera'), kind: 'camera', name: 'Fake CCD', failureDomain: FailureDomain.make('fake-ccd') },
  { id: DeviceId.make('mount'), kind: 'mount', name: 'ZWO AM5', failureDomain: FailureDomain.make('zwo-am5') },
  { id: DeviceId.make('focuser'), kind: 'focuser', name: 'Fake Focuser', failureDomain: FailureDomain.make('fake-focuser') },
]

const frame = { width: 4, height: 3 }

/** A running operation's ending, due when its timer fires. */
interface Due {
  readonly at: number
  readonly timer: ReturnType<typeof setTimeout>
}

/** What one Cria process holds. A restart replaces all of it. */
interface Instance {
  readonly id: InstanceId
  sequence: number
  /** When every device was last read. Readings postdate an operation settled before it. */
  readAt: number
  readonly bindings: Map<FailureDomain, BindingId>
  /** Recoveries, keyed by the binding each one ended. */
  readonly recoveries: Map<BindingId, { readonly at: number; readonly note: string }>
  readonly operations: Map<OperationId, Operation>
  readonly requests: Map<RequestId, { readonly content: string; readonly operationId: OperationId }>
  readonly due: Map<OperationId, Due>
  readonly images: Map<ImageId, { readonly image: Image; readonly bytes: Uint8Array<ArrayBuffer> }>
}

const settledShown = 20

export class FakeCria {
  readonly origin = 'http://cria.fake:4319'
  /** Every request Cria received, in order. A request sent while unreachable never arrived. */
  readonly received: Received[] = []
  /** False partitions the network: requests fail and open streams go quiet. */
  reachable = true
  commandsEnabled = true
  /** How long a running motion or capture takes to stand still once asked to stop. */
  stopMs = 0
  /** How long each kind runs before it confirms. A capture runs for its exposure. */
  readonly durationMs: Partial<Record<CommandKind, number>> = {}
  private instance = this.boot()
  private readonly streams = new Set<ReadableStreamDefaultController<Uint8Array>>()
  private readonly lostReplies = new Set<Route>()
  private readonly delays = new Map<Route, number>()
  private readonly cadence = setInterval(() => this.read(), 1_000)

  constructor(private readonly token?: string) {}

  get instanceId(): InstanceId {
    return this.instance.id
  }

  bindingOf(deviceId: string): BindingId {
    return this.binding(this.rigged(deviceId).failureDomain)
  }

  /** The next request on `route` is applied, but its reply never reaches the caller. */
  dropReply(route: Route): void {
    this.lostReplies.add(route)
  }

  /** The next request on `route` reaches Cria `ms` later. A caller's abort ends its wait, not the request. */
  delay(route: Route, ms: number): void {
    this.delays.set(route, ms)
  }

  /** Ends a running operation now, as Cria would on this outcome. */
  settle(operationId: string, outcome: Ending): void {
    const operation = this.instance.operations.get(OperationId.make(operationId))

    if (operation?.state !== 'running') throw new Error(`No running operation ${operationId}`)
    clearTimeout(this.instance.due.get(operation.id)?.timer)
    this.instance.due.delete(operation.id)

    const { progress: _, ...started } = operation
    const now = Date.now()

    this.instance.operations.set(operation.id, { ...started, state: 'settled', settledAt: now, outcome, recovery: null })

    const halt = this.openIn(operation.failureDomain).find(open => open.state === 'waiting')

    if (halt) this.start({ ...halt, state: 'running', startedAt: now, progress: { phase: 'preparing', elapsedSeconds: null } })
    this.publish()
  }

  /** Models Cria evicting an image from its rolling set. */
  dropImage(imageId: string): void {
    this.instance.images.delete(ImageId.make(imageId))
  }

  /** A new Cria process: a new instance with new bindings, remembering nothing. Open streams end. */
  restart(): void {
    for (const due of this.instance.due.values()) clearTimeout(due.timer)

    for (const stream of this.streams) stream.error(new TypeError('Cria restarted'))
    this.streams.clear()
    this.instance = this.boot()
  }

  close(): void {
    clearInterval(this.cadence)

    for (const due of this.instance.due.values()) clearTimeout(due.timer)

    for (const stream of this.streams) stream.close()
    this.streams.clear()
  }

  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)

    if (!this.reachable) throw new TypeError('fetch failed')
    const path = new URL(request.url).pathname
    const found = routeOf(request.method, path)
    const body = request.method === 'POST' ? await request.text() : undefined

    this.received.push({ route: found?.route, method: request.method, path, body })

    if (!found) return this.refuse('not-found', 'No such route')
    const { route, segments } = found
    const delayMs = this.delays.get(route)

    this.delays.delete(route)

    const answered =
      delayMs === undefined
        ? this.answer(route, segments, request, body)
        : unlessAborted(later(delayMs).then(() => this.answer(route, segments, request, body)), request.signal)

    const response = await answered

    if (this.lostReplies.delete(route)) throw new TypeError('fetch failed: the reply was lost')

    return response
  }

  private answer(route: Route, segments: ReadonlyArray<string>, request: Request, body: string | undefined): Response {
    if (route === 'health') return this.reply(Health, { status: 'ok', protocolVersion }, 200)

    if (this.token !== undefined && request.headers.get('authorization') !== `Bearer ${this.token}`)
      return this.refuse('unauthorized', 'Bearer token required')

    const [first = '', second = ''] = segments

    switch (route) {
      case 'state':
        return this.reply(State, this.snapshot(), 200)
      case 'events':
        return this.subscribe()
      case 'submit':
        return this.admit(body ?? '')
      case 'operation':
        return this.withOperation(first, operation => this.reply(Operation, this.view(operation), 200))
      case 'cancel':
        return this.withOperation(first, operation => this.cancel(operation))
      case 'lookup':
        return this.lookup(first, second)
      case 'recover':
        return this.recover(first, body ?? '')
      case 'image':
        return this.original(first)
    }
  }

  /** SPEC "Admission", in its order. */
  private admit(body: string): Response {
    const request = decode(OperationRequest, body)

    if (!request) return this.refuse('request-error', 'Not an operation request')
    const content = JSON.stringify(request, [...Object.keys(request), ...Object.keys(request.parameters)].sort())
    const known = this.instance.requests.get(request.requestId)

    if (known) {
      if (known.content !== content) return this.refuse('request-conflict', 'This request ID was used with different content')

      return this.withOperation(known.operationId, operation => this.reply(Operation, this.view(operation), 202))
    }

    if (request.instanceId !== this.instance.id) return this.refuse('instance-changed', 'Cria restarted: this request was for an earlier instance')
    const device = rig.find(candidate => candidate.id === request.deviceId)

    if (!device) return this.refuse('request-error', `Unknown device ${request.deviceId}`)

    if (request.bindingId !== this.binding(device.failureDomain))
      return this.refuse('binding-changed', 'The device binding changed; read the state again')

    if (request.expectedName !== device.name) return this.refuse('binding-changed', `This device is ${device.name}`)
    const runsOn = commands[request.kind].device

    if (runsOn !== 'any' && runsOn !== device.kind) return this.refuse('request-error', `A ${device.kind} cannot run ${request.kind}`)

    if (!this.commandsEnabled) return this.refuse('commands-disabled', 'Commands are disabled')

    const now = Date.now()
    const accepted = { ...request, id: OperationId.make(randomUUID()), failureDomain: device.failureDomain, acceptedAt: now }
    const open = this.openIn(device.failureDomain)
    const quarantine = this.quarantineOf(device.failureDomain)

    if (!isHalt(accepted) && quarantine.held) return this.refuse('device-blocked', `Blocked until recovered: ${quarantine.reason}`)

    if (!isHalt(accepted) && open.length > 0) return this.refuse('device-busy', 'The device is running another operation')
    this.instance.requests.set(request.requestId, { content, operationId: accepted.id })

    if (isHalt(accepted) && open.length > 0) {
      const waiting: Operation = { ...accepted, state: 'waiting' }

      this.instance.operations.set(waiting.id, waiting)

      for (const operation of open) if (operation.state === 'running' && !isHalt(operation)) this.stop(operation)
      this.publish()

      return this.reply(Operation, waiting, 202)
    }

    const running: Running = { ...accepted, state: 'running', startedAt: now, progress: { phase: 'preparing', elapsedSeconds: null } }

    this.start(running)
    this.publish()

    return this.reply(Operation, running, 202)
  }

  private start(operation: Running): void {
    const { kind, parameters } = operation
    const afterMs = kind === 'capture' ? parameters.exposureSeconds * 1_000 : (this.durationMs[kind] ?? 0)

    this.instance.operations.set(operation.id, operation)
    this.schedule(operation, afterMs, { kind: 'confirmed', value: { values: {}, image: null } })
  }

  private schedule(operation: Running, afterMs: number, outcome: Ending): void {
    const timer = setTimeout(() => this.settle(operation.id, this.confirmCapture(operation, outcome)), afterMs)

    this.instance.due.set(operation.id, { at: Date.now() + afterMs, timer })
  }

  /** A stop moves the ending earlier, never later: a capture that finishes first still confirms. */
  private stop(operation: Running): void {
    const due = this.instance.due.get(operation.id)

    if (!due || due.at <= Date.now() + this.stopMs) return
    clearTimeout(due.timer)
    this.schedule(operation, this.stopMs, { kind: 'stopped' })
  }

  private confirmCapture(operation: Running, outcome: Ending): Ending {
    if (operation.kind !== 'capture' || outcome.kind !== 'confirmed') return outcome
    const bytes = imageBytes()
    const now = Date.now()
    const camera = this.rigged(operation.deviceId)
    const id = ImageId.make(randomUUID())

    const image: Image = {
      id,
      operationId: operation.id,
      instanceId: operation.instanceId,
      deviceId: operation.deviceId,
      cameraName: camera.name,
      bindingId: operation.bindingId,
      ...frame,
      binX: 1,
      binY: 1,
      startX: 0,
      startY: 0,
      exposureSeconds: operation.parameters.exposureSeconds,
      color: 'mono',
      capturedAt: now,
      capturedAtSource: 'camera',
      retainedAt: now,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      original: { mediaType: 'application/imagebytes', bytes: bytes.byteLength, url: `/v2/images/${id}/original` },
    }

    this.instance.images.set(id, { image, bytes })

    return { kind: 'confirmed', value: { values: {}, image } }
  }

  /** SPEC "Halts, stops and cancel": the operation as it is now; a running motion or capture is asked to stop. */
  private cancel(operation: Operation): Response {
    if (operation.state === 'running' && !isHalt(operation)) this.stop(operation)

    return this.reply(Operation, this.view(operation), 202)
  }

  private lookup(instanceId: string, requestId: string): Response {
    const known = instanceId === this.instance.id && Schema.is(RequestId)(requestId) ? this.instance.requests.get(requestId) : undefined

    if (!known) return this.refuse('not-found', 'No such request')

    return this.withOperation(known.operationId, operation => this.reply(Operation, this.view(operation), 200))
  }

  /** SPEC "Recovery": refused while an operation is open; otherwise a new binding for the whole domain. */
  private recover(deviceId: string, body: string): Response {
    const request = decode(RecoveryRequest, body)

    if (!request) return this.refuse('request-error', 'Not a recovery request')
    const device = rig.find(candidate => candidate.id === deviceId)

    if (!device) return this.refuse('not-found', `No device ${deviceId}`)

    if (request.instanceId !== this.instance.id) return this.refuse('instance-changed', 'Cria restarted')
    const binding = this.binding(device.failureDomain)

    if (request.bindingId !== binding) return this.refuse('binding-changed', 'The device binding changed')

    if (this.openIn(device.failureDomain).length > 0)
      return this.refuse('device-busy', 'An operation is still open on this device; recover it once that settles')

    this.instance.recoveries.set(binding, { at: Date.now(), note: request.note })
    this.instance.bindings.set(device.failureDomain, BindingId.make(randomUUID()))
    this.publish()

    return this.reply(Device, this.device(device), 200)
  }

  private original(imageId: string): Response {
    if (!Schema.is(ImageId)(imageId)) return this.refuse('not-found', 'No such image')
    const kept = this.instance.images.get(imageId)

    if (!kept) return this.refuse('image-gone', 'This image is no longer kept')

    return new Response(kept.bytes, {
      headers: {
        'content-type': 'application/imagebytes',
        'content-length': String(kept.bytes.byteLength),
        etag: `"${kept.image.sha256}"`,
      },
    })
  }

  private subscribe(): Response {
    let subscriber: ReadableStreamDefaultController<Uint8Array> | undefined

    return new Response(
      new ReadableStream<Uint8Array>({
        start: controller => {
          subscriber = controller
          this.streams.add(controller)
          controller.enqueue(this.event())
        },
        cancel: () => {
          if (subscriber) this.streams.delete(subscriber)
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    )
  }

  /** The one-second cadence: Cria reads every device again, then sends a snapshot. */
  private read(): void {
    this.instance.readAt = Date.now()
    this.publish()
  }

  /** SPEC "Event stream": a snapshot within 250 ms of a change; this one goes at once. */
  private publish(): void {
    if (this.streams.size === 0) return
    const event = this.event()

    if (!this.reachable) return

    for (const stream of this.streams) stream.enqueue(event)
  }

  private event(): Uint8Array {
    const state = Schema.encodeSync(State)(this.snapshot())

    return new TextEncoder().encode(`event: state\ndata: ${JSON.stringify(state)}\n\n`)
  }

  private snapshot(): State {
    const operations = [...this.instance.operations.values()]
    const hidden = new Set(operations.filter(operation => operation.state === 'settled' && !this.holds(operation)).slice(0, -settledShown))

    this.instance.sequence++

    return {
      protocolVersion,
      instanceId: this.instance.id,
      sequence: this.instance.sequence,
      generatedAt: Date.now(),
      commandsEnabled: this.commandsEnabled,
      devices: rig.map(device => this.device(device)),
      operations: operations.flatMap(operation => (hidden.has(operation) ? [] : [this.view(operation)])),
    }
  }

  private device(device: Rigged): Device {
    const { id, name, failureDomain } = device
    const observedAt = this.instance.readAt
    const settled = this.settledIn(failureDomain)
    const read = settled.filter(operation => operation.settledAt < observedAt)

    const identity = {
      id,
      name,
      bindingId: this.binding(failureDomain),
      failureDomain,
      availability: this.availability(device, read.length < settled.length),
      quarantine: this.quarantineOf(failureDomain),
      afterOperation: read.at(-1)?.id ?? null,
    }

    switch (device.kind) {
      case 'camera':
        return { ...identity, kind: 'camera', readings: cameraReadings(name, observedAt), lastCommandedSetpointC: null }
      case 'mount':
        return { ...identity, kind: 'mount', readings: mountReadings(name, observedAt) }
      case 'focuser':
        return { ...identity, kind: 'focuser', readings: focuserReadings(name, observedAt) }
    }
  }

  /** SPEC "Device": the reasons the fake models, in their order of precedence. */
  private availability(device: Rigged, refreshing: boolean): Device['availability'] {
    const quarantine = this.quarantineOf(device.failureDomain)

    if (!this.commandsEnabled) return { ready: false, reason: 'commands-disabled', message: 'Commands are disabled' }

    if (quarantine.held) return { ready: false, reason: 'blocked', message: quarantine.reason }

    if (this.openIn(device.failureDomain).length > 0) return { ready: false, reason: 'busy', message: 'An operation is open' }

    if (refreshing) return { ready: false, reason: 'refreshing', message: 'Not read since the last operation settled' }

    return { ready: true }
  }

  /** SPEC "Quarantine": held from the first uncertain ending under the current binding until a recovery. */
  private quarantineOf(failureDomain: FailureDomain): Device['quarantine'] {
    const first = this.settledIn(failureDomain).find(operation => this.holds(operation))

    if (first?.outcome.kind !== 'uncertain') return { held: false }

    return { held: true, reason: first.outcome.message, since: first.settledAt }
  }

  private holds(operation: Operation): boolean {
    return operation.state === 'settled' && operation.outcome.kind === 'uncertain' && operation.bindingId === this.binding(operation.failureDomain)
  }

  /** An uncertain operation carries the recovery of the binding it ended under. */
  private view(operation: Operation): Operation {
    if (operation.state !== 'settled' || operation.outcome.kind !== 'uncertain') return operation

    return { ...operation, recovery: this.instance.recoveries.get(operation.bindingId) ?? null }
  }

  private openIn(failureDomain: FailureDomain): ReadonlyArray<Exclude<Operation, Settled>> {
    return [...this.instance.operations.values()].filter(
      (operation): operation is Exclude<Operation, Settled> => operation.failureDomain === failureDomain && operation.state !== 'settled',
    )
  }

  private settledIn(failureDomain: FailureDomain): ReadonlyArray<Settled> {
    return [...this.instance.operations.values()]
      .filter((operation): operation is Settled => operation.failureDomain === failureDomain && operation.state === 'settled')
      .sort((a, b) => a.settledAt - b.settledAt)
  }

  private withOperation(operationId: string, found: (operation: Operation) => Response): Response {
    const operation = Schema.is(OperationId)(operationId) ? this.instance.operations.get(operationId) : undefined

    return operation ? found(operation) : this.refuse('not-found', 'No such operation')
  }

  private binding(failureDomain: FailureDomain): BindingId {
    const binding = this.instance.bindings.get(failureDomain)

    if (!binding) throw new Error(`No binding for ${failureDomain}`)

    return binding
  }

  private rigged(deviceId: string): Rigged {
    const device = rig.find(candidate => candidate.id === deviceId)

    if (!device) throw new Error(`No device ${deviceId}`)

    return device
  }

  private boot(): Instance {
    return {
      id: InstanceId.make(randomUUID()),
      sequence: 0,
      readAt: Date.now(),
      bindings: new Map(rig.map(device => [device.failureDomain, BindingId.make(randomUUID())])),
      recoveries: new Map(),
      operations: new Map(),
      requests: new Map(),
      due: new Map(),
      images: new Map(),
    }
  }

  private reply<S extends Schema.Top & { readonly EncodingServices: never }>(schema: S, body: S['Type'], status: number): Response {
    return Response.json(Schema.encodeSync(schema)(body), { status })
  }

  private refuse(code: ErrorCode, message: string): Response {
    return this.reply(ErrorBody, { error: { code, message }, instanceId: this.instance.id }, statusOf[code])
  }
}

/** Decodes a JSON body at the fake's boundary, refusing unknown keys as Cria does. */
function decode<S extends Schema.Top & { readonly DecodingServices: never }>(schema: S, body: string): S['Type'] | undefined {
  try {
    return Schema.decodeUnknownSync(schema)(JSON.parse(body), { onExcessProperty: 'error' })
  } catch {
    return undefined
  }
}

function later(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function unlessAborted(reply: Promise<Response>, signal: AbortSignal): Promise<Response> {
  return new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    reply.then(resolve, reject)
  })
}

/** ImageBytes v1: a rank-two Int32 frame, first dimension outermost. */
function imageBytes(): Uint8Array<ArrayBuffer> {
  const { width, height } = frame
  const view = new DataView(new ArrayBuffer(44 + width * height * 4))
  const header = [1, 0, 0, 0, 44, 2, 2, 2, width, height, 0]

  header.forEach((value, index) => view.setInt32(index * 4, value, true))

  for (let pixel = 0; pixel < width * height; pixel++) view.setInt32(44 + pixel * 4, 1_000 + pixel, true)

  return new Uint8Array(view.buffer)
}

type Fresh<T> = { readonly [K in keyof T]: { readonly status: 'fresh'; readonly value: T[K]; readonly observedAt: number } }

function fresh<T extends Record<string, string | number | boolean | ReadonlyArray<{ name: string; degreesPerSecond: number }>>>(
  values: T,
  observedAt: number,
): Fresh<T> {
  // SAFETY: Object.fromEntries forgets the keys of `values`; each key keeps its own value, wrapped.
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { status: 'fresh', value, observedAt }])) as Fresh<T>
}

function cameraReadings(name: string, observedAt: number) {
  return {
    ...fresh(
      {
        connected: true,
        name,
        activity: 'idle',
        temperatureC: -10,
        coolerOn: true,
        coolerPowerPercent: 40,
        sensorWidthPixels: frame.width,
        sensorHeightPixels: frame.height,
        pixelWidthMicrons: 3.76,
        pixelHeightMicrons: 3.76,
        binX: 1,
        binY: 1,
        width: frame.width,
        height: frame.height,
        startX: 0,
        startY: 0,
        maxBinX: 4,
        maxBinY: 4,
        bayerPattern: 'mono',
        canAbortExposure: true,
        canSetTemperature: true,
        canGetCoolerPower: true,
        exposureMinimum: 0.000032,
        exposureMaximum: 3600,
        gain: 100,
        gainMinimum: 0,
        gainMaximum: 500,
        offset: 10,
        offsetMinimum: 0,
        offsetMaximum: 100,
      } as const,
      observedAt,
    ),
    setpointC: { status: 'unavailable', reason: 'unsupported' },
  } as const
}

function mountReadings(name: string, observedAt: number) {
  return fresh(
    {
      connected: true,
      name,
      rightAscensionHours: 6.5,
      declinationDegrees: 40,
      siderealTimeHours: 6.5,
      slewing: false,
      tracking: true,
      parked: false,
      trackingRate: 'sidereal',
      rightAscensionRateSecondsPerSiderealSecond: 0,
      declinationRateArcsecondsPerSecond: 0,
      pierSide: 'east',
      coordinateSystem: 'topocentric',
      latitudeDegrees: 40,
      longitudeDegrees: -75,
      elevationMeters: 0,
      canSlew: true,
      canSetTracking: true,
      canFindHome: true,
      canPark: true,
      canUnpark: true,
      canMovePrimaryAxis: true,
      primaryAxisRates: [{ name: '1x', degreesPerSecond: 15.041067 / 3600 }],
    } as const,
    observedAt,
  )
}

function focuserReadings(name: string, observedAt: number) {
  return fresh({ connected: true, name, position: 20_000, moving: false, temperatureC: 8, absolute: true, minStep: 15_500, maxStep: 38_000 } as const, observedAt)
}
