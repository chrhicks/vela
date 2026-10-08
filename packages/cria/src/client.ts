import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { EquipmentError, type Frame } from '@vela/equipment'
import { imageBytesPixels } from '@vela/equipment/image-bytes'
import { z } from 'zod'
import {
  CriaApiError,
  CriaCancelledError,
  CriaIdentityError,
  CriaOperationFailedError,
  CriaNotAdmittedError,
  CriaUncertainError,
} from './error.js'
import { CriaHttp } from './http.js'
import { CriaEvents, type ObservedState } from './events.js'
import {
  CriaArchiveReceiptSchema,
  CriaClientConfigSchema,
  CriaCommandSchema,
  CriaCustodyPageSchema,
  CriaCustodySchema,
  CriaImageSchema,
  CriaOperationSchema,
  CriaRefreshSchema,
  CriaStateSchema,
  type CriaArchiveReceipt,
  type CriaClientConfig,
  type CriaCustody,
  type CriaCommand,
  type CriaDevice,
  type CriaDeviceBinding,
  type CriaImage,
  type CriaOperation,
  type CriaOperationRequest,
  type CriaState,
  type CriaValue,
} from './schema.js'

export type { ObservedState } from './events.js'

export interface CriaClientOptions extends Omit<CriaClientConfig, 'devices'> {
  devices: readonly CriaDeviceBinding[]
  fetch?: typeof globalThis.fetch
  requestTimeoutMs?: number
  /** Admission and original-transfer retry cadence; healthy state is never polled. */
  pollIntervalMs?: number
  admissionTimeoutMs?: number
  observationTimeoutMs?: number
  /** Added to requested exposure time; includes driver cleanup and original retention. */
  operationTimeoutMs?: number
  operationReconcileMs?: number
  imageTimeoutMs?: number
  imageRetryMs?: number
  dynamicMaxAgeMs?: number
  metadataMaxAgeMs?: number
  maxStateRoundTripMs?: number
  eventIdleTimeoutMs?: number
  eventReconnectMs?: number
  eventMaxReconnectMs?: number
  maxPixels?: number
}

export interface CriaRunOptions {
  /** After admission, abort requests equipment cleanup and continues following its outcome. */
  signal?: AbortSignal
  onProgress?: (operation: CriaOperation) => void
  onReadState?: (state: 'current' | 'retrying') => void
}

export interface CriaObserveOptions {
  signal?: AbortSignal
  allowDisconnected?: boolean
}

export interface CriaReadingOptions {
  metadata?: boolean
}

interface ActiveOperation {
  request: CriaOperationRequest | null
  operation: CriaOperation | null
  failureDomain: string | null
  cancelRequested: boolean
  unresolved: boolean
  failure: CriaUncertainError | null
  cancellation: AbortController
}

const timingSchema = z.strictObject({
  requestTimeoutMs: z.number().int().min(1).max(60_000).default(5_000),
  pollIntervalMs: z.number().int().min(1).max(10_000).default(250),
  admissionTimeoutMs: z.number().int().min(1).max(300_000).default(15_000),
  observationTimeoutMs: z.number().int().min(1).max(300_000).default(15_000),
  operationTimeoutMs: z.number().int().min(1).max(3_600_000).default(660_000),
  operationReconcileMs: z.number().int().min(1).max(60_000).default(1_000),
  imageTimeoutMs: z.number().int().min(1).max(3_600_000).default(600_000),
  imageRetryMs: z.number().int().min(1).max(300_000).default(15_000),
  dynamicMaxAgeMs: z.number().int().min(1).max(120_000).default(6_000),
  metadataMaxAgeMs: z.number().int().min(1).max(7_200_000).default(65_000),
  maxStateRoundTripMs: z.number().int().min(1).max(60_000).default(3_000),
  eventIdleTimeoutMs: z.number().int().min(1).max(60_000).default(10_000),
  eventReconnectMs: z.number().int().min(1).max(60_000).default(250),
  eventMaxReconnectMs: z.number().int().min(1).max(60_000).default(5_000),
  maxPixels: z.number().int().min(1).max(100_000_000).default(40_000_000),
})

function terminal(operation: CriaOperation): boolean {
  return operation.status !== 'accepted' && operation.status !== 'running'
}

function sameParameters(operation: CriaOperation, request: CriaOperationRequest): boolean {
  const expected = Object.entries(request.parameters).filter(([, value]) => value !== undefined)

  return Object.keys(operation.parameters).length === expected.length &&
    expected.every(([key, value]) => operation.parameters[key] === value)
}

/** One authenticated service connection, shared across its configured devices and workflows. */
export class CriaClient {
  private readonly config: CriaClientConfig
  private readonly timing: z.infer<typeof timingSchema>
  private readonly http: CriaHttp
  private instanceId: string | null = null
  private readonly bindings = new Map<string, string>()
  private readonly failureDomains = new Map<string, string>()
  private readonly readBarriers = new Map<string, number>()
  private readonly active = new Map<string, ActiveOperation>()
  private readonly completions = new Map<string, Promise<CriaOperation>>()
  private writeFailure: EquipmentError | null = null
  private events: CriaEvents | null = null
  private closed = false

  constructor(options: CriaClientOptions) {
    const {
      baseUrl, token, storeId, devices, fetch = globalThis.fetch,
      ...timing
    } = options

    this.config = CriaClientConfigSchema.parse({ baseUrl, token, storeId, devices })
    this.timing = timingSchema.parse(timing)
    this.http = new CriaHttp(baseUrl, token, fetch, this.timing.requestTimeoutMs)
  }

  /** Start once at service composition; every device shares this authenticated stream. */
  start(): void {
    if (this.closed) throw new EquipmentError('Cria client is closed', { reason: 'transport', endpoint: '/v2/events' })
    this.events ??= new CriaEvents(this.http, this.timing, state => this.pin(state))
  }

  /** Stop transport observation. This does not claim or request physical equipment cancellation. */
  async close(): Promise<void> {
    this.closed = true
    await this.events?.close()
  }

  get commandBlockReason(): string | null {
    return this.writeFailure?.message ?? null
  }

  commandBlockReasonFor(id: string): string | null {
    this.binding(id)

    if (this.writeFailure) return this.writeFailure.message
    const domain = this.failureDomains.get(id)

    for (const active of this.active.values())
      if (active.failure && (active.request?.deviceId === id || active.failureDomain === domain))
        return active.failure.message

    return null
  }

  private invalid(message: string, endpoint = '/v2/state'): EquipmentError {
    return new EquipmentError(message, { reason: 'invalid-response', endpoint })
  }

  private binding(id: string): CriaDeviceBinding {
    const binding = this.config.devices.find(device => device.id === id)

    if (!binding) throw new CriaIdentityError('Device is not bound to this Cria service', '/v2/state')

    return binding
  }

  private pin(state: CriaState): void {
    if (state.storeId !== this.config.storeId) {
      const error = new CriaIdentityError('Cria durable store identity changed', '/v2/state')

      this.writeFailure ??= error
      throw error
    }

    if (this.instanceId !== null && this.instanceId !== state.instanceId)
      this.writeFailure ??= new CriaIdentityError(
        'Cria restarted; inspect the new device ownership before issuing more commands', '/v2/state',
      )
    this.instanceId ??= state.instanceId

    for (const binding of this.config.devices) {
      const device = state.devices.find(candidate => candidate.id === binding.id)

      if (!device || device.kind !== binding.kind || device.expectedName !== binding.expectedName) {
        const error = new CriaIdentityError('Configured Cria device identity changed', '/v2/state')

        this.writeFailure ??= error
        throw error
      }

      const previous = this.bindings.get(device.id)
      const previousDomain = this.failureDomains.get(device.id)

      if (previous !== undefined && previous !== device.bindingId)
        this.writeFailure ??= new CriaIdentityError(
          'Cria driver binding changed; inspect the recovered equipment before issuing commands', '/v2/state',
        )

      if (previous === undefined) this.bindings.set(device.id, device.bindingId)

      if (previousDomain !== undefined && previousDomain !== device.failureDomain)
        this.writeFailure ??= new CriaIdentityError('Cria failure-domain binding changed', '/v2/state')

      if (previousDomain === undefined) this.failureDomains.set(device.id, device.failureDomain)
    }
  }

  /** Concurrent callers share the latest complete snapshot from one service stream. */
  async state(signal?: AbortSignal): Promise<ObservedState> {
    signal?.throwIfAborted()
    this.start()

    if (!this.events) throw this.invalid('Cria state stream was not started')

    return this.events.state(signal)
  }

  device(snapshot: ObservedState, id: string): CriaDevice {
    const binding = this.binding(id)
    const device = snapshot.state.devices.find(candidate => candidate.id === id)

    if (snapshot.state.storeId !== this.config.storeId || !device ||
      device.kind !== binding.kind || device.expectedName !== binding.expectedName)
      throw new CriaIdentityError('Cria device does not match its configured identity', '/v2/state')

    return device
  }

  optionalReading(
    snapshot: ObservedState,
    device: CriaDevice,
    key: string,
    options: CriaReadingOptions = {},
  ): CriaValue | undefined {
    const reading = device.fields[key]
    const barrier = this.readBarriers.get(device.id)

    if (this.closed || this.events && !this.events.owns(snapshot) ||
      barrier !== undefined && device.observationGeneration <= barrier ||
      device.blocked || device.refreshPending || !reading || reading.status !== 'current' ||
      reading.generation !== device.observationGeneration || reading.observedAt === null ||
      reading.readStartedAt === null || reading.checkedAt === null ||
      reading.readStartedAt > reading.observedAt || reading.observedAt > reading.checkedAt ||
      reading.checkedAt > snapshot.state.generatedAt ||
      snapshot.roundTripMs > this.timing.maxStateRoundTripMs)
      return undefined

    // All server timestamps share a clock. Include the whole RTT and time since receipt,
    // so an unsynchronized client clock cannot turn delayed observations into fresh ones.
    const age = snapshot.state.generatedAt - reading.readStartedAt + snapshot.roundTripMs +
      Math.max(0, performance.now() - snapshot.receivedMonotonic)

    const limit = options.metadata ? this.timing.metadataMaxAgeMs : this.timing.dynamicMaxAgeMs

    if (age < 0 || age > limit) return undefined

    return reading.value
  }

  reading(
    snapshot: ObservedState,
    device: CriaDevice,
    key: string,
    options: CriaReadingOptions = {},
  ): CriaValue {
    const value = this.optionalReading(snapshot, device, key, options)

    if (value === undefined) {
      if (device.blocked)
        throw new CriaUncertainError(device.reason ?? 'Cria driver ownership is unresolved', '/v2/state', null, null)
      const field = device.fields[key]
      const message = `Cria ${key} observation is unavailable or stale`

      if (!field || field.status === 'unsupported') throw this.invalid(message)

      if (field.status === 'current' && (
        field.readStartedAt === null || field.observedAt === null || field.checkedAt === null ||
        field.readStartedAt > field.observedAt || field.observedAt > field.checkedAt ||
        field.checkedAt > snapshot.state.generatedAt
      )) throw this.invalid(`Cria ${key} observation has invalid measurement timestamps`)

      throw new EquipmentError(message, { reason: 'transport', endpoint: '/v2/state' })
    }

    return value
  }

  async observe(id: string, options: CriaObserveOptions = {}): Promise<{
    snapshot: ObservedState
    device: CriaDevice
  }> {
    const deadline = performance.now() + this.timing.observationTimeoutMs

    for (;;) {
      const snapshot = await this.state(options.signal)
      const device = this.device(snapshot, id)

      if (device.blocked)
        throw new CriaUncertainError(
          device.reason ?? 'Cria driver ownership is unresolved', '/v2/state', null, null,
        )
      const connected = this.optionalReading(snapshot, device, 'connected')
      const observedName = this.optionalReading(snapshot, device, 'name')

      if (!device.refreshPending && connected === false) {
        if (options.allowDisconnected) return { snapshot, device }
        throw this.invalid('Cria device is disconnected')
      }

      if (connected === true && observedName !== undefined && observedName !== device.expectedName)
        throw new CriaIdentityError('Observed equipment name differs from the binding', '/v2/state')

      if (!device.refreshPending && connected === true && observedName === device.expectedName)
        return { snapshot, device }

      if (performance.now() >= deadline) {
        this.reading(snapshot, device, 'connected')
        this.reading(snapshot, device, 'name')
        throw this.invalid('Fresh Cria identity observation timed out')
      }

      if (!this.events) throw this.invalid('Cria state stream was not started')

      if (this.events.current !== snapshot) continue
      await this.events.wait(this.events.version, deadline - performance.now(), options.signal)
    }
  }

  async refresh(id: string): Promise<z.infer<typeof CriaRefreshSchema>> {
    this.binding(id)
    await this.state()
    const result = await this.http.json(`/v2/devices/${encodeURIComponent(id)}/refresh`, CriaRefreshSchema, 'POST')

    if (result.deviceId !== id) throw this.invalid('Cria refreshed another device')
    this.readBarriers.set(id, result.generation - 1)

    return result
  }

  private requirePostWriteObservation(snapshot: ObservedState, operation: CriaOperation): void {
    // Cria invalidates the whole domain at admission and completion, and accepts no
    // poll result while its write lane is held. HTTP can finish before those events
    // arrive: the pre-write snapshot must not become a post-write confirmation.
    for (const device of snapshot.state.devices)
      if (device.failureDomain === operation.failureDomain)
        this.readBarriers.set(device.id, device.observationGeneration)
  }

  private verifyOperation(operation: CriaOperation, request?: CriaOperationRequest): void {
    const binding = this.binding(operation.deviceId)

    if (operation.expectedName !== binding.expectedName)
      throw new CriaIdentityError('Cria operation belongs to another device identity', '/v2/operations')

    if (request && (operation.instanceId !== request.instanceId ||
      operation.requestId !== request.requestId || operation.deviceId !== request.deviceId ||
      operation.bindingId !== request.bindingId || operation.expectedName !== request.expectedName ||
      operation.kind !== request.kind || !sameParameters(operation, request)))
      throw new CriaIdentityError('Cria operation differs from the admitted request', '/v2/operations')
  }

  async operation(id: string): Promise<CriaOperation> {
    z.uuid().parse(id)

    if (this.instanceId === null) await this.state()
    const operation = await this.http.json(`/v2/operations/${id}`, CriaOperationSchema)

    if (operation.id !== id) throw this.invalid('Cria returned another operation', '/v2/operations')
    this.verifyOperation(operation)

    return operation
  }

  /** The response acknowledges a cleanup request. It does not establish that equipment stopped. */
  async cancel(operation: CriaOperation): Promise<CriaOperation> {
    const original = CriaOperationSchema.parse(operation)

    const request: CriaOperationRequest = {
      instanceId: original.instanceId,
      requestId: original.requestId,
      deviceId: original.deviceId,
      bindingId: original.bindingId,
      expectedName: original.expectedName,
      ...CriaCommandSchema.parse({ kind: original.kind, parameters: original.parameters }),
    }

    this.verifyOperation(original)
    const result = await this.http.json(`/v2/operations/${original.id}/cancel`, CriaOperationSchema, 'POST')

    if (result.id !== original.id)
      throw new CriaIdentityError('Cria cancellation returned another operation', '/v2/operations')

    this.verifyOperation(result, request)

    return result
  }

  private uncertain(message: string, active: ActiveOperation, options?: ErrorOptions): CriaUncertainError {
    const error = new CriaUncertainError(message, '/v2/operations', active.request, active.operation, options)

    active.unresolved = true
    active.failure = error

    if (active.operation === null || options?.cause instanceof CriaIdentityError)
      this.writeFailure ??= error

    return error
  }

  private async admit(request: CriaOperationRequest, active: ActiveOperation): Promise<CriaOperation> {
    const body = JSON.stringify(request)
    const deadline = performance.now() + this.timing.admissionTimeoutMs

    try {
      const operation = await this.http.json('/v2/operations', CriaOperationSchema, 'POST', body)

      this.verifyOperation(operation, request)

      return operation
    } catch (error) {
      // A well-formed rejection of the first attempt establishes non-admission.
      // Transport errors, malformed acknowledgements and server failures do not.
      if (error instanceof CriaApiError && error.status < 500 && error.status !== 410) throw error
    }

    for (;;) {
      try {
        const operation = await this.http.json(
          `/v2/requests/${request.instanceId}/${encodeURIComponent(request.requestId)}`,
          CriaOperationSchema,
        )

        this.verifyOperation(operation, request)

        return operation
      } catch (error) {
        if (error instanceof CriaIdentityError || error instanceof CriaApiError && error.status === 410)
          throw this.uncertain('Cria admission was accepted but its outcome cannot be established', active, { cause: error })

        if (error instanceof CriaApiError && error.status === 404 && !active.cancelRequested) {
          try {
            await this.state()

            if (this.writeFailure) throw this.writeFailure
            const operation = await this.http.json('/v2/operations', CriaOperationSchema, 'POST', body)

            this.verifyOperation(operation, request)

            return operation
          } catch (retryError) {
            if (retryError instanceof CriaIdentityError)
              throw this.uncertain('Cria identity changed while admission was unresolved', active, { cause: retryError })
            // Keep the exact original body. A retry rejection cannot settle an earlier lost attempt.
          }
        }
      }

      if (performance.now() >= deadline)
        throw this.uncertain('Cria admission response was lost; the original request remains unresolved', active)
      await delay(this.timing.pollIntervalMs)
    }
  }

  private async follow(
    active: ActiveOperation,
    options: CriaRunOptions,
    events: CriaEvents,
  ): Promise<CriaOperation> {
    const request = active.request
    const admitted = active.operation

    if (!request || !admitted) throw this.invalid('Cria operation was not admitted', '/v2/operations')
    let operation: CriaOperation = admitted
    const exposureMs = request.kind === 'capture' ? request.parameters.exposureSeconds * 1000 : 0
    const deadline = performance.now() + exposureMs + this.timing.operationTimeoutMs
    let version = -1
    let missing = false
    let lastReconciledAt = -Infinity
    let nextReconcileAt = Infinity
    let interrupted = false

    for (;;) {
      options.onProgress?.(operation)
      options.onReadState?.(interrupted ? 'retrying' : operation.observation)

      if (terminal(operation)) return operation

      if (this.closed || performance.now() >= deadline)
        throw this.uncertain('Cria operation observation ended; equipment completion is unconfirmed', active)

      if (active.cancelRequested && !operation.cancelRequested) {
        try {
          operation = await this.cancel(operation)
          this.verifyOperation(operation, request)
          active.operation = operation

          if (terminal(operation)) continue
        } catch (error) {
          if (error instanceof CriaIdentityError)
            throw this.uncertain('Cria cancellation identity could not be confirmed', active, { cause: error })
          interrupted = true
          options.onReadState?.('retrying')
        }
      }

      const latest = events.current

      const snapshotDeadline = latest === null ? Infinity :
        latest.receivedMonotonic + this.timing.eventIdleTimeoutMs

      const observationExpired = performance.now() >= snapshotDeadline

      if (version !== events.version || observationExpired && !missing) {
        const initial = version === -1

        version = events.version
        const snapshot = observationExpired ? null : latest
        const operationId = operation.id
        const candidate = snapshot?.state.operations.find(value => value.id === operationId)

        try {
          if (candidate) {
            this.verifyOperation(candidate, request)

            // A just-returned HTTP admission/cancellation response can be ahead of the
            // latest event. Do not regress its acknowledged progress or cleanup request.
            if (terminal(candidate) ||
              (!operation.cancelRequested || candidate.cancelRequested) &&
              !(operation.status === 'running' && candidate.status === 'accepted') &&
              (candidate.elapsedSeconds ?? 0) >= (operation.elapsedSeconds ?? 0))
              operation = candidate
            active.operation = operation
            interrupted = false
            missing = false
            nextReconcileAt = Infinity
            lastReconciledAt = -Infinity
            continue
          }

          interrupted = snapshot === null
          missing = true
          nextReconcileAt = Math.max(lastReconciledAt + this.timing.operationReconcileMs,
            performance.now() + (initial && !interrupted ? this.timing.operationReconcileMs : 0))
        } catch (error) {
          if (error instanceof CriaIdentityError ||
            error instanceof EquipmentError && error.reason === 'invalid-response' ||
            error instanceof CriaApiError && [404, 410].includes(error.status))
            throw this.uncertain('Cria operation outcome is no longer available', active, { cause: error })
          interrupted = true
        }
      }

      // A lost connection or eviction from Cria's recent terminal list is an explicit
      // observation gap. Reconcile only that gap, paced independently of stream cadence.
      if (missing && performance.now() >= nextReconcileAt) {
        lastReconciledAt = performance.now()
        nextReconcileAt = lastReconciledAt + this.timing.operationReconcileMs

        try {
          operation = await this.operation(operation.id)
          this.verifyOperation(operation, request)
          active.operation = operation

          if (terminal(operation)) interrupted = false
          continue
        } catch (error) {
          if (error instanceof CriaIdentityError ||
            error instanceof EquipmentError && error.reason === 'invalid-response' ||
            error instanceof CriaApiError && [404, 410].includes(error.status))
            throw this.uncertain('Cria operation outcome is no longer available', active, { cause: error })
          interrupted = true
        }
      }

      options.onReadState?.(interrupted ? 'retrying' : operation.observation)

      try {
        await events.wait(version,
          Math.min(deadline, nextReconcileAt, missing ? Infinity : snapshotDeadline) - performance.now(),
          active.cancelRequested ? undefined : active.cancellation.signal)
      } catch (error) {
        if (!active.cancelRequested) throw error
      }
    }
  }

  private async execute(
    id: string,
    command: CriaCommand,
    active: ActiveOperation,
    options: CriaRunOptions,
  ): Promise<CriaOperation> {
    const observed = await this.observe(id, {
      ...options,
      allowDisconnected: command.kind === 'device-connect',
    })

    if (this.writeFailure) throw this.writeFailure
    const { device, snapshot } = observed

    if (!snapshot.state.commandsEnabled) throw new CriaApiError(403, 'commands-disabled', 'Cria equipment writes are disabled', '/v2/operations')

    for (const other of this.active.values())
      if (other !== active && other.failureDomain === device.failureDomain)
        throw other.failure ?? new CriaApiError(409, 'device-busy', 'Cria failure domain already has active work', '/v2/operations')

    options.signal?.throwIfAborted()

    if (active.cancelRequested) throw new CriaCancelledError(null, '/v2/operations')
    active.failureDomain = device.failureDomain

    const request: CriaOperationRequest = {
      instanceId: snapshot.state.instanceId,
      requestId: randomUUID(),
      deviceId: id,
      bindingId: device.bindingId,
      expectedName: device.expectedName,
      ...command,
    }

    active.request = request
    active.operation = await this.admit(request, active)
    this.requirePostWriteObservation(snapshot, active.operation)
    let operation: CriaOperation

    try {
      if (!this.events) throw this.invalid('Cria state stream was not started')
      operation = await this.follow(active, options, this.events)
    } catch (error) {
      if (error instanceof CriaUncertainError) throw error
      throw this.uncertain('Cria operation observation ended before equipment completion was confirmed', active, { cause: error })
    }

    if (operation.status === 'uncertain' || !operation.settled || operation.blocksDevice)
      throw this.uncertain(operation.message ?? 'Cria equipment outcome remains unresolved', active)

    if (operation.status === 'cancelled') throw new CriaCancelledError(operation, '/v2/operations')

    if (operation.status !== 'succeeded') throw new CriaOperationFailedError(operation, '/v2/operations')

    return operation
  }

  run(id: string, command: CriaCommand, options: CriaRunOptions = {}): Promise<CriaOperation> {
    if (options.signal?.aborted) return Promise.reject(new CriaCancelledError(null, '/v2/operations'))
    this.binding(id)

    if (this.writeFailure) return Promise.reject(this.writeFailure)

    const existing = this.active.get(id)

    if (existing)
      return Promise.reject(existing.failure ?? new CriaApiError(409, 'device-busy', 'Cria device already has active work', '/v2/operations'))

    const validated = CriaCommandSchema.parse(command)

    const active: ActiveOperation = {
      request: null,
      operation: null,
      failureDomain: null,
      cancelRequested: false,
      unresolved: false,
      failure: null,
      cancellation: new AbortController(),
    }

    const onAbort = () => {
      active.cancelRequested = true
      active.cancellation.abort()
    }

    this.active.set(id, active)
    options.signal?.addEventListener('abort', onAbort, { once: true })

    const completion = this.execute(id, validated, active, options).catch(error => {
      if (active.request === null && options.signal?.aborted &&
        (error === options.signal.reason || error instanceof Error && error.name === 'AbortError'))
        throw new CriaCancelledError(null, '/v2/operations')

      if (active.request === null && error instanceof EquipmentError &&
        error.reason === 'transport' && !(error instanceof CriaUncertainError))
        throw new CriaNotAdmittedError(error)
      throw error
    }).finally(() => {
      options.signal?.removeEventListener('abort', onAbort)

      if (!active.unresolved) {
        this.active.delete(id)
        this.completions.delete(id)
      }
    })

    this.completions.set(id, completion)

    return completion
  }

  /** Cancel only this client's owned work, including admission still being reconciled. */
  async cancelDevice(id: string): Promise<void> {
    this.binding(id)
    const active = this.active.get(id)
    const completion = this.completions.get(id)

    if (!active || !completion) return
    active.cancelRequested = true
    active.cancellation.abort()

    try {
      await completion
    } catch (error) {
      if (error instanceof CriaCancelledError || error instanceof CriaOperationFailedError) return

      throw error
    }
  }

  /**
   * The verified original of a completed capture, with its exact bytes for preservation.
   * Cria keeps its copy until an archive receipt is accepted; nothing is released here.
   */
  async download(
    operation: CriaOperation,
    options: Pick<CriaRunOptions, 'onReadState'> = {},
  ): Promise<{ image: CriaImage; frame: Frame; original: Uint8Array }> {
    const validated = CriaOperationSchema.parse(operation)

    this.verifyOperation(validated)

    if (validated.kind !== 'capture' || validated.status !== 'succeeded' ||
      !validated.settled || validated.blocksDevice || !validated.image)
      throw this.invalid('Cria capture did not retain a confirmed original', '/v2/images')
    const image = CriaImageSchema.parse(validated.image)

    if (image.operationId !== validated.id || image.instanceId !== validated.instanceId ||
      image.bindingId !== validated.bindingId || image.deviceId !== validated.deviceId ||
      image.cameraName !== validated.expectedName || image.id !== validated.reservedImageId ||
      image.exposureSeconds !== validated.parameters.exposureSeconds)
      throw this.invalid('Cria original does not belong to the completed capture', '/v2/images')

    const bytes = await this.transferOriginal(image, options)
    const original = new Uint8Array(bytes)
    let pixels: Float64Array

    try {
      pixels = imageBytesPixels(bytes, image.width, image.height)
    } catch (error) {
      throw new EquipmentError('Cria original geometry or pixel encoding is invalid', {
        reason: 'invalid-response', endpoint: image.original.url, cause: error,
      })
    }

    options.onReadState?.('current')

    return {
      image,
      original,
      frame: {
        width: image.width,
        height: image.height,
        pixels,
        capturedAt: new Date(image.capturedAt).toISOString(),
        capturedAtSource: image.capturedAtSource,
        color: image.color === 'mono' ? { kind: 'mono' } : { kind: 'bayer', pattern: image.color },
      },
    }
  }

  /** Cria's custody record for an image, readable whatever its operation outcome. */
  async custody(imageId: string): Promise<CriaCustody> {
    const record = await this.http.json(`/v2/images/${imageId}`, CriaCustodySchema)

    if (record.id !== imageId || record.storeId !== this.config.storeId)
      throw this.invalid('Cria custody belongs to another image or store', '/v2/images')

    return record
  }

  /** One page of verified originals still awaiting archive, in admission order. */
  async retainedOriginals(after = 0): Promise<{ images: CriaCustody[]; next: number }> {
    const page = await this.http.json(`/v2/images?state=retained&after=${after}&limit=50`, CriaCustodyPageSchema)

    if (page.storeId !== this.config.storeId ||
      page.images.some(record => record.state !== 'retained' || record.storeId !== page.storeId))
      throw this.invalid('Cria returned originals from another store or state', '/v2/images')

    return { images: page.images, next: page.next }
  }

  /**
   * The same verified bytes for an existing result. This never starts, retries or rearms
   * equipment, and works while the operation that produced it remains uncertain.
   */
  async originalOf(
    record: CriaCustody,
    options: Pick<CriaRunOptions, 'onReadState'> = {},
  ): Promise<Uint8Array> {
    const image = record.image

    if (!['retained', 'archived'].includes(record.state) || !image)
      throw this.invalid('Cria has no verified local original for this image', '/v2/images')

    if (record.storeId !== this.config.storeId || image.id !== record.id ||
      image.operationId !== record.operationId || image.bindingId !== record.bindingId ||
      image.deviceId !== record.deviceId)
      throw this.invalid('Cria custody identities do not match its original', '/v2/images')

    return new Uint8Array(await this.transferOriginal(image, options))
  }

  /** Send a receipt Vela recorded after verifying its archive; retrying the same receipt is safe. */
  async acknowledgeArchive(receipt: CriaArchiveReceipt): Promise<CriaCustody> {
    const validated = CriaArchiveReceiptSchema.parse(receipt)

    if (validated.storeId !== this.config.storeId)
      throw this.invalid('Archive receipt names another Cria store', '/v2/images')

    const path = `/v2/images/${validated.imageId}/archive-receipt`
    const record = await this.http.json(path, CriaCustodySchema, 'POST', JSON.stringify(validated))

    if (record.id !== validated.imageId || record.receipt?.receiptId !== validated.receiptId ||
      !['archived', 'released'].includes(record.state))
      throw this.invalid('Cria did not record this archive receipt', path)

    return record
  }

  private async transferOriginal(
    image: CriaImage,
    options: Pick<CriaRunOptions, 'onReadState'>,
  ): Promise<ArrayBuffer> {
    if (image.width * image.height > this.timing.maxPixels ||
      image.original.bytes > 44 + 4 * this.timing.maxPixels)
      throw this.invalid('Cria original exceeds this client\'s pixel bound', '/v2/images')

    // Originals survive API incarnations and stream loss, but never belong to a
    // replacement store. Reconcile that ownership over HTTP if the stream is unavailable.
    const retryDeadline = performance.now() + this.timing.imageRetryMs

    await this.originalState(retryDeadline, options)

    for (;;) {
      try {
        return await this.http.original(
          image.original.url, image.original.bytes, image.sha256, this.timing.imageTimeoutMs,
        )
      } catch (error) {
        const transient = error instanceof EquipmentError && error.reason === 'transport' ||
          error instanceof CriaApiError && [429, 500, 502, 503, 504].includes(error.status)

        if (!transient || performance.now() + this.timing.pollIntervalMs >= retryDeadline) throw error
        options.onReadState?.('retrying')
        await delay(this.timing.pollIntervalMs)
      }
    }
  }

  private async originalState(
    deadline: number,
    options: Pick<CriaRunOptions, 'onReadState'>,
  ): Promise<ObservedState> {
    try {
      return await this.state()
    } catch (error) {
      if (this.closed || !(error instanceof EquipmentError) || error.reason !== 'transport') throw error
    }

    options.onReadState?.('retrying')

    for (;;) {
      const started = performance.now()

      try {
        const state = await this.http.json('/v2/state', CriaStateSchema)
        const receivedMonotonic = performance.now()

        this.pin(state)

        return {
          state,
          receivedAt: Date.now(),
          receivedMonotonic,
          roundTripMs: receivedMonotonic - started,
        }
      } catch (error) {
        const transient = error instanceof EquipmentError && error.reason === 'transport' ||
          error instanceof CriaApiError && [429, 500, 502, 503, 504].includes(error.status)

        if (!transient || this.closed || performance.now() + this.timing.pollIntervalMs >= deadline) throw error
        await delay(this.timing.pollIntervalMs)
      }
    }
  }
}
