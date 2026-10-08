import { createHash, randomUUID } from 'node:crypto'
import { setImmediate } from 'node:timers/promises'
import { z } from 'zod'
import {
  CriaArchiveReceiptSchema,
  CriaClient,
  CriaCommandSchema,
  CriaOperationRequestSchema,
  type CriaClientOptions,
  type CriaCustody,
  type CriaDevice,
  type CriaImage,
  type CriaOperation,
  type CriaReading,
  type CriaState,
  type CriaValue,
} from '../src/index.js'

export const serviceOrigin = 'http://cria.fixture:4319'

export const token = 'fixture-private-token-with-32-characters'

export const serverNow = 1_700_000_000_000

const clients: CriaClient[] = []

export async function closeFixtures(): Promise<void> {
  await Promise.all(clients.splice(0).map(client => client.close()))
}

export function eventResponse(value: CriaValue): Response {
  return new Response(`event: state\ndata: ${JSON.stringify(value)}\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  })
}

export function json(value: CriaValue, status = 200): Response {
  return Response.json(value, { status })
}

export function failure(status: number, code = 'unavailable'): Response {
  return json({ error: { code, message: 'Fixture service error' } }, status)
}

export function reading(value: CriaValue, at = serverNow): CriaReading {
  return {
    value,
    observedAt: at,
    checkedAt: at,
    readStartedAt: at,
    generation: 4,
    status: 'current',
    message: null,
  }
}

function device(id: string, kind: CriaDevice['kind']): CriaDevice {
  return {
    id,
    kind,
    bindingId: randomUUID(),
    expectedName: `Fixture ${id}`,
    failureDomain: id,
    health: 'ready',
    blocked: false,
    reason: null,
    observationGeneration: 4,
    refreshPending: false,
    commandReady: true,
    fields: {
      connected: reading(true),
      name: reading(`Fixture ${id}`),
      state: reading(0),
      width: reading(2),
      height: reading(3),
    },
    channels: [],
  }
}

export function pixels(): ArrayBuffer {
  const bytes = new ArrayBuffer(44 + 6 * 4)
  const view = new DataView(bytes)
  const header = [1, 0, 1, 1, 44, 2, 2, 2, 2, 3, 0]

  header.forEach((value, index) => view.setInt32(index * 4, value, true))
  // Independent ASCOM rank-two wire order: first dimension outermost.
  const samples = [1, 3, 5, 2, 4, 6]

  samples.forEach((value, index) => view.setInt32(44 + index * 4, value, true))

  return bytes
}

export class ServiceFixture {
  private readonly subscribers = new Set<ReadableStreamDefaultController<Uint8Array>>()
  readonly camera = device('camera', 'camera')
  readonly mount = device('mount', 'mount')
  readonly state: CriaState = {
    protocolVersion: 3,
    storeId: randomUUID(),
    instanceId: randomUUID(),
    sequence: 1,
    generatedAt: serverNow,
    commandsEnabled: true,
    admissionStoppedReason: null,
    devices: [this.camera, this.mount],
    operations: [],
  }
  readonly operations = new Map<string, CriaOperation>()
  readonly requests = new Map<string, CriaOperation>()
  readonly posts: string[] = []
  readonly paths: string[] = []
  readonly deletes: string[] = []
  readonly receipts: string[] = []
  readonly custody = new Map<string, CriaCustody>()
  readonly cancellations: string[] = []
  original = pixels()
  completeImmediately = true
  /** Model Cria's release of its local copy once a receipt is accepted. */
  releaseOnReceipt = false
  cancelImmediately = false
  publishOperations = true
  last: CriaOperation | null = null

  client(options: Partial<CriaClientOptions> = {}): CriaClient {
    const client = new CriaClient({
      baseUrl: serviceOrigin,
      token,
      storeId: this.state.storeId,
      devices: this.state.devices.map(({ id, kind, expectedName }) => ({ id, kind, expectedName })),
      fetch: this.fetch,
      pollIntervalMs: 1,
      admissionTimeoutMs: 30,
      observationTimeoutMs: 100,
      operationTimeoutMs: 1_000,
      imageRetryMs: 30,
      eventReconnectMs: 5,
      eventMaxReconnectMs: 20,
      ...options,
    })

    clients.push(client)

    return client
  }

  /** Publish changed fixture state and let the stream consumer accept it. */
  async publish(): Promise<void> {
    this.state.sequence++
    this.state.operations = [...this.operations.values()]
    const bytes = new TextEncoder().encode(`event: state\ndata: ${JSON.stringify(this.state)}\n\n`)

    for (const subscriber of this.subscribers) subscriber.enqueue(bytes)
    await setImmediate()
  }

  /** Drop live subscriptions; subsequent GET /v2/events reconnects unless fetch rejects it. */
  interrupt(): void {
    for (const subscriber of this.subscribers) subscriber.error(new TypeError('Fixture stream interrupted'))
    this.subscribers.clear()
  }

  get streamCount(): number { return this.subscribers.size }

  finish(status: CriaOperation['status'] = 'succeeded'): CriaOperation {
    const operation = this.last

    if (!operation) throw new Error('Fixture has no admitted operation')
    operation.status = status
    operation.phase = 'finished'
    operation.completedAt = serverNow
    operation.settled = status !== 'uncertain'
    operation.blocksDevice = !operation.settled

    if (operation.kind === 'capture' && status === 'succeeded') {
      operation.image = this.image(operation)
      this.retain(operation, operation.image)
    }

    // Represent the fresh post-write observation. Production additionally publishes
    // its invalidated generation while the domain's write lane is still held.
    for (const device of this.state.devices) {
      if (device.failureDomain !== operation.failureDomain) continue
      device.observationGeneration++

      for (const field of Object.values(device.fields))
        if (field.status === 'current') field.generation = device.observationGeneration
    }

    if (this.publishOperations) void this.publish()

    return operation
  }

  /** Cria custody for a verified original, as after adoption by result or later discovery. */
  retain(operation: CriaOperation, image = this.image(operation)): CriaCustody {
    const record: CriaCustody = {
      id: image.id,
      storeId: this.state.storeId,
      operationId: operation.id,
      requestId: operation.requestId,
      instanceId: operation.instanceId,
      deviceId: operation.deviceId,
      bindingId: operation.bindingId,
      cameraName: operation.expectedName,
      state: 'retained',
      reservedAt: serverNow,
      updatedAt: serverNow,
      reason: null,
      context: {
        version: 1,
        requested: operation.parameters,
        cameraObservations: { gain: reading(10) },
        observationsNote: 'Latest Cria readings when the capture was admitted',
      },
      image,
      discovery: 'operation-result',
      candidate: null,
      receipt: null,
      receiptFingerprint: null,
      receiptAcceptedAt: null,
      releasedAt: null,
      history: [],
    }

    this.custody.set(record.id, record)

    return record
  }

  image(operation: CriaOperation): CriaImage {
    if (!operation.reservedImageId) throw new Error('Fixture capture lacks a reservation')

    return {
      id: operation.reservedImageId,
      operationId: operation.id,
      instanceId: operation.instanceId,
      deviceId: operation.deviceId,
      cameraName: operation.expectedName,
      bindingId: operation.bindingId,
      width: 2,
      height: 3,
      binX: 1,
      binY: 1,
      startX: 0,
      startY: 0,
      exposureSeconds: z.number().parse(operation.parameters.exposureSeconds),
      capturedAt: serverNow,
      capturedAtSource: 'camera',
      retainedAt: serverNow,
      color: 'mono',
      sha256: createHash('sha256').update(new Uint8Array(this.original)).digest('hex'),
      original: {
        mediaType: 'application/imagebytes',
        bytes: this.original.byteLength,
        url: `/v2/images/${operation.reservedImageId}/original`,
      },
      preview: null,
    }
  }

  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname
    const method = init?.method ?? 'GET'

    this.paths.push(`${method} ${path}`)

    if (new Headers(init?.headers).get('authorization') !== `Bearer ${token}`)
      return failure(401, 'unauthorized')

    if (init?.redirect !== 'error') throw new Error('Fixture requires redirect refusal')

    if (path === '/v2/state') return json(this.state)

    if (path === '/v2/events') {
      let subscriber: ReadableStreamDefaultController<Uint8Array> | undefined

      return new Response(new ReadableStream<Uint8Array>({
        start: controller => {
          subscriber = controller
          this.subscribers.add(controller)
          void this.publish()
        },
        cancel: () => {
          if (subscriber) this.subscribers.delete(subscriber)
        },
      }), { headers: { 'content-type': 'text/event-stream' } })
    }

    if (path === '/v2/operations' && method === 'POST') {
      const text = z.string().parse(init?.body)
      const request = CriaOperationRequestSchema.parse(JSON.parse(text))
      const command = CriaCommandSchema.parse({ kind: request.kind, parameters: request.parameters })

      this.posts.push(text)
      const existing = this.requests.get(request.requestId)

      if (existing) return json(existing, 202)

      const operation: CriaOperation = {
        ...request,
        kind: command.kind,
        id: randomUUID(),
        failureDomain: request.deviceId,
        acceptedAt: serverNow,
        startedAt: serverNow,
        elapsedSeconds: 0,
        completedAt: null,
        status: 'running',
        phase: 'exposing',
        acknowledged: true,
        cancelRequested: false,
        blocksDevice: true,
        settled: false,
        observation: 'current',
        message: null,
        result: {},
        reservedImageId: command.kind === 'capture' ? randomUUID() : null,
        image: null,
        reconciliation: null,
      }

      this.operations.set(operation.id, operation)
      this.requests.set(operation.requestId, operation)
      this.last = operation

      if (this.completeImmediately) this.finish()
      else if (this.publishOperations) void this.publish()

      return json(operation, 202)
    }

    if (path.startsWith('/v2/requests/')) {
      const operation = this.requests.get(path.split('/').at(-1) ?? '')

      return operation ? json(operation) : failure(404, 'not-found')
    }

    if (path.startsWith('/v2/operations/')) {
      const id = path.split('/')[3] ?? ''
      const operation = this.operations.get(id)

      if (!operation) return failure(404, 'not-found')

      if (path.endsWith('/cancel')) {
        this.cancellations.push(id)
        operation.cancelRequested = true

        if (this.cancelImmediately) this.finish('cancelled')
        else if (this.publishOperations) void this.publish()
      }

      return json(operation, method === 'POST' ? 202 : 200)
    }

    if (path === '/v2/images') {
      const images = [...this.custody.values()].filter(record => record.state === 'retained')

      return json({ storeId: this.state.storeId, images, next: images.length })
    }

    if (path.startsWith('/v2/images/')) {
      const record = this.custody.get(path.split('/')[3] ?? '')

      if (!record?.image) return failure(404, 'not-found')

      if (method === 'DELETE') {
        this.deletes.push(record.id)

        return failure(409, 'archive-receipt-required')
      }

      if (path.endsWith('/archive-receipt')) {
        const receipt = CriaArchiveReceiptSchema.parse(JSON.parse(z.string().parse(init?.body)))

        this.receipts.push(receipt.receiptId)

        if (record.receipt)
          return record.receipt.receiptId === receipt.receiptId ? json(record) : failure(409, 'receipt-conflict')

        if (receipt.sha256 !== record.image.sha256 || receipt.storeId !== record.storeId)
          return failure(409, 'receipt-conflict')
        Object.assign(record, { state: this.releaseOnReceipt ? 'released' : 'archived', receipt, receiptAcceptedAt: serverNow })

        return json(record)
      }

      if (path.endsWith('/original') && !['retained', 'archived'].includes(record.state))
        return failure(410, 'image-gone')

      if (path.endsWith('/original'))
        return new Response(this.original, {
          headers: {
            'content-type': 'application/imagebytes',
            'content-length': String(this.original.byteLength),
            etag: `"${record.image.sha256}"`,
          },
        })

      return json(record)
    }

    throw new Error(`Unexpected fixture request: ${method} ${path}`)
  }
}
