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
import {
  CriaClientConfigSchema,
  CriaCommandSchema,
  CriaImageSchema,
  CriaOperationSchema,
  CriaRefreshSchema,
  CriaReleaseSchema,
  CriaStateSchema,
  type CriaClientConfig,
  type CriaCommand,
  type CriaDevice,
  type CriaDeviceBinding,
  type CriaImage,
  type CriaOperation,
  type CriaOperationRequest,
  type CriaState,
  type CriaValue,
} from './schema.js'

export interface ObservedState {
  state: CriaState
  receivedAt: number
  roundTripMs: number
  receivedMonotonic: number
}

export interface CriaClientOptions extends Omit<CriaClientConfig, 'devices'> {
  devices: readonly CriaDeviceBinding[]
  fetch?: typeof globalThis.fetch
  requestTimeoutMs?: number
  pollIntervalMs?: number
  admissionTimeoutMs?: number
  observationTimeoutMs?: number
  /** Added to requested exposure time; includes driver cleanup and original retention. */
  operationTimeoutMs?: number
  imageTimeoutMs?: number
  imageRetryMs?: number
  dynamicMaxAgeMs?: number
  metadataMaxAgeMs?: number
  maxStateRoundTripMs?: number
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
}

const timingSchema = z.strictObject({
  requestTimeoutMs: z.number().int().min(1).max(60_000).default(5_000),
  pollIntervalMs: z.number().int().min(1).max(10_000).default(250),
  admissionTimeoutMs: z.number().int().min(1).max(300_000).default(15_000),
  observationTimeoutMs: z.number().int().min(1).max(300_000).default(15_000),
  operationTimeoutMs: z.number().int().min(1).max(3_600_000).default(660_000),
  imageTimeoutMs: z.number().int().min(1).max(3_600_000).default(600_000),
  imageRetryMs: z.number().int().min(1).max(300_000).default(15_000),
  dynamicMaxAgeMs: z.number().int().min(1).max(120_000).default(6_000),
  metadataMaxAgeMs: z.number().int().min(1).max(7_200_000).default(65_000),
  maxStateRoundTripMs: z.number().int().min(1).max(60_000).default(3_000),
  maxPixels: z.number().int().min(1).max(100_000_000).default(40_000_000),
})

async function waitFor<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work
  signal.throwIfAborted()
  let onAbort = () => {}

  const interrupted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
  })

  try {
    return await Promise.race([work, interrupted])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

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
  private stateRead: Promise<ObservedState> | null = null
  private instanceId: string | null = null
  private readonly bindings = new Map<string, string>()
  private readonly failureDomains = new Map<string, string>()
  private readonly active = new Map<string, ActiveOperation>()
  private readonly completions = new Map<string, Promise<CriaOperation>>()
  private readonly images = new Map<string, CriaImage>()
  private writeFailure: EquipmentError | null = null

  constructor(options: CriaClientOptions) {
    const {
      baseUrl, token, storeId, devices, fetch = globalThis.fetch,
      ...timing
    } = options

    this.config = CriaClientConfigSchema.parse({ baseUrl, token, storeId, devices })
    this.timing = timingSchema.parse(timing)
    this.http = new CriaHttp(baseUrl, token, fetch, this.timing.requestTimeoutMs)
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

  /** Concurrent callers share one request; caller cancellation does not cancel other readers. */
  state(signal?: AbortSignal): Promise<ObservedState> {
    signal?.throwIfAborted()

    if (!this.stateRead) {
      const started = performance.now()

      const request = this.http.json('/v2/state', CriaStateSchema).then(state => {
        const receivedMonotonic = performance.now()

        const snapshot = {
          state,
          receivedAt: Date.now(),
          roundTripMs: receivedMonotonic - started,
          receivedMonotonic,
        }

        this.pin(state)

        return snapshot
      })

      this.stateRead = request
      void request.finally(() => {
        if (this.stateRead === request) this.stateRead = null
      }).catch(() => {})
    }

    return waitFor(this.stateRead, signal)
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

    if (device.blocked || device.refreshPending || !reading || reading.status !== 'current' ||
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

    if (value === undefined) throw this.invalid(`Cria ${key} observation is unavailable or stale`)

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

      if (performance.now() >= deadline) throw this.invalid('Fresh Cria identity observation timed out')
      await delay(this.timing.pollIntervalMs, undefined, { signal: options.signal })
    }
  }

  async refresh(id: string): Promise<z.infer<typeof CriaRefreshSchema>> {
    this.binding(id)
    await this.state()
    const result = await this.http.json(`/v2/devices/${encodeURIComponent(id)}/refresh`, CriaRefreshSchema, 'POST')

    if (result.deviceId !== id) throw this.invalid('Cria refreshed another device')

    return result
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

  private async follow(active: ActiveOperation, options: CriaRunOptions): Promise<CriaOperation> {
    const request = active.request
    let operation = active.operation

    if (!request || !operation) throw this.invalid('Cria operation was not admitted', '/v2/operations')
    const exposureMs = request.kind === 'capture' ? request.parameters.exposureSeconds * 1000 : 0
    const deadline = performance.now() + exposureMs + this.timing.operationTimeoutMs
    let interrupted = false

    for (;;) {
      options.onProgress?.(operation)
      options.onReadState?.(interrupted ? 'retrying' : operation.observation)

      if (terminal(operation)) return operation

      if (performance.now() >= deadline)
        throw this.uncertain('Cria operation observation timed out; equipment completion is unconfirmed', active)

      if (active.cancelRequested && !operation.cancelRequested) {
        try {
          operation = await this.cancel(operation)
          this.verifyOperation(operation, request)
          active.operation = operation
          interrupted = false

          if (terminal(operation)) continue
        } catch (error) {
          if (error instanceof CriaIdentityError)
            throw this.uncertain('Cria cancellation identity could not be confirmed', active, { cause: error })
          // Repeating this idempotent request only sets cancelRequested on the same operation.
          interrupted = true
          options.onReadState?.('retrying')
        }
      }

      await delay(this.timing.pollIntervalMs)

      try {
        operation = await this.operation(operation.id)
        this.verifyOperation(operation, request)
        active.operation = operation
        interrupted = false
      } catch (error) {
        if (error instanceof CriaIdentityError ||
          error instanceof EquipmentError && error.reason === 'invalid-response' ||
          error instanceof CriaApiError &&
          [404, 410].includes(error.status))
          throw this.uncertain('Cria operation outcome is no longer available', active, { cause: error })
        interrupted = true
        options.onReadState?.('retrying')
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
    let operation: CriaOperation

    try {
      operation = await this.follow(active, options)
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
    }

    const onAbort = () => { active.cancelRequested = true }

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

    try {
      await completion
    } catch (error) {
      if (error instanceof CriaCancelledError || error instanceof CriaOperationFailedError) return

      throw error
    }
  }

  async download(
    operation: CriaOperation,
    options: Pick<CriaRunOptions, 'onReadState'> = {},
  ): Promise<{ image: CriaImage; frame: Frame }> {
    const validated = CriaOperationSchema.parse(operation)

    this.verifyOperation(validated)

    if (validated.kind !== 'capture' || validated.status !== 'succeeded' ||
      !validated.settled || validated.blocksDevice || !validated.image)
      throw this.invalid('Cria capture did not retain a confirmed original', '/v2/images')
    const image = CriaImageSchema.parse(validated.image)

    if (image.operationId !== validated.id || image.instanceId !== validated.instanceId ||
      image.bindingId !== validated.bindingId || image.deviceId !== validated.deviceId ||
      image.cameraName !== validated.expectedName || image.id !== validated.reservedImageId ||
      image.exposureSeconds !== validated.parameters.exposureSeconds ||
      image.width * image.height > this.timing.maxPixels ||
      image.original.bytes > 44 + 4 * this.timing.maxPixels)
      throw this.invalid('Cria original does not belong to the completed capture', '/v2/images')

    // Completed originals survive API incarnations, but never belong to a replacement store.
    const snapshot = await this.state()
    const retainedFor = image.expiresAt - snapshot.state.generatedAt - snapshot.roundTripMs

    if (retainedFor <= 0)
      throw new CriaApiError(410, 'image-gone', 'Cria original retention has expired', image.original.url)

    const retryDeadline = performance.now() + Math.min(this.timing.imageRetryMs, retainedFor)
    let bytes: ArrayBuffer

    for (;;) {
      try {
        bytes = await this.http.original(
          image.original.url, image.original.bytes, image.sha256, this.timing.imageTimeoutMs,
        )
        break
      } catch (error) {
        const transient = error instanceof EquipmentError && error.reason === 'transport' ||
          error instanceof CriaApiError && [429, 500, 502, 503, 504].includes(error.status)

        if (!transient || performance.now() + this.timing.pollIntervalMs >= retryDeadline) throw error
        options.onReadState?.('retrying')
        await delay(this.timing.pollIntervalMs)
      }
    }

    let pixels: Float64Array

    try {
      pixels = imageBytesPixels(bytes, image.width, image.height)
    } catch (error) {
      throw new EquipmentError('Cria original geometry or pixel encoding is invalid', {
        reason: 'invalid-response', endpoint: image.original.url, cause: error,
      })
    }

    this.images.set(image.id, image)
    options.onReadState?.('current')

    return {
      image,
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

  /** Release only an original whose verified pixels were handed to this client. */
  async release(imageId: string): Promise<void> {
    if (!this.images.has(imageId)) throw this.invalid('Cria original has not been acquired by this client', '/v2/images')

    // Pixels already belong to Vela. Cria retention handles a failed best-effort release;
    // keep no growing collection of cleanup failures across a long capture run.
    this.images.delete(imageId)
    await this.state()

    try {
      const result = await this.http.json(`/v2/images/${imageId}`, CriaReleaseSchema, 'DELETE')

      if (result.id !== imageId) throw this.invalid('Cria released another image', '/v2/images')
    } catch (error) {
      // Expired or forgotten temporary originals already own no releasable storage.
      if (!(error instanceof CriaApiError && [404, 410].includes(error.status))) throw error
    }

  }
}
