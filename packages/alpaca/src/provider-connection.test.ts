import type { ResponseFixture } from './internal/test-fixtures.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AlpacaProviderError,
  createAlpacaProvider,
  type AlpacaDeviceConnectionResult,
} from './index.js'

interface RecordedRequest {
  readonly path: string
  readonly method: string
  readonly contentType: string | null
  readonly body: string | undefined
}

type ResponseFactory = (signal: AbortSignal | null) => Promise<Response>

type RouteResult = ResponseFixture | Error | Response | ResponseFactory

function envelope(Value: ResponseFixture, ErrorNumber = 0, ErrorMessage = '') {
  return { Value, ClientTransactionID: 0, ServerTransactionID: 1, ErrorNumber, ErrorMessage }
}

function methodEnvelope(ErrorNumber = 0, ErrorMessage = '') {
  return { ClientTransactionID: 0, ServerTransactionID: 1, ErrorNumber, ErrorMessage }
}

function stalledRequest(signal: AbortSignal | null): Promise<Response> {
  return new Promise((_resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)

      return
    }

    signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}

function scriptedFetch(
  results: ReadonlyArray<RouteResult>,
  requests: RecordedRequest[] = [],
): typeof globalThis.fetch {
  let index = 0

  return async (input, init) => {
    const url = new URL(String(input))
    requests.push({
      path: url.pathname,
      method: init?.method ?? 'GET',
      contentType: new Headers(init?.headers).get('content-type'),
      body: init?.body instanceof URLSearchParams ? init.body.toString() : undefined,
    })

    const result = results[index]
    index += 1

    if (result instanceof Error) throw result

    if (result instanceof Response) return result

    if (result instanceof Function) return result(init?.signal ?? null)

    if (result === undefined) return new Response('Not found', { status: 404 })

    return Response.json(result)
  }
}

const configuredCamera = {
  DeviceName: 'Seestar Camera',
  DeviceType: 'Camera',
  DeviceNumber: 0,
  UniqueID: 'camera-1',
}

const inventory = envelope([configuredCamera])

const unsupportedConnecting = methodEnvelope(1024, 'Connecting is not implemented')

function provider(results: ReadonlyArray<RouteResult>, requests: RecordedRequest[] = []) {
  return createAlpacaProvider({
    baseUrl: 'http://alpaca.test',
    fetch: scriptedFetch(results, requests),
    requestTimeoutMs: 20,
    connectionPollIntervalMs: 10,
    connectionVerificationTimeoutMs: 30,
  })
}

function connectingProvider(connectionDurationMs: number) {
  let requestedAt: number | undefined

  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname
    const method = init?.method ?? 'GET'

    if (method === 'GET' && path === '/management/v1/configureddevices') {
      return Response.json(inventory)
    }

    if (method === 'PUT' && path === '/api/v1/camera/0/connected') {
      requestedAt = Date.now()

      return Response.json(methodEnvelope())
    }

    const connected = requestedAt !== undefined && Date.now() - requestedAt >= connectionDurationMs

    if (method === 'GET' && path === '/api/v1/camera/0/connected') {
      return Response.json(envelope(connected))
    }

    if (method === 'GET' && path === '/api/v1/camera/0/connecting') {
      return Response.json(envelope(requestedAt !== undefined && !connected))
    }

    throw new Error(`Unexpected request: ${method} ${path}`)
  })

  const alpaca = createAlpacaProvider({
    baseUrl: 'http://alpaca.test',
    fetch,
    requestTimeoutMs: 20,
    connectionPollIntervalMs: 10,
    connectionVerificationTimeoutMs: 30,
  })

  return { alpaca, fetch }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('Alpaca device connection', () => {
  it('connects a Seestar-like device with the documented form-encoded setter and verifies it', async () => {
    const requests: RecordedRequest[] = []

    const alpaca = provider(
      [inventory, envelope(false), methodEnvelope(), envelope(true)],
      requests,
    )

    const expected: AlpacaDeviceConnectionResult = { outcome: 'connected', command: 'requested' }
    await expect(alpaca.connectDevice('camera-1')).resolves.toEqual(expected)
    expect(requests).toEqual([
      expect.objectContaining({ path: '/management/v1/configureddevices', method: 'GET' }),
      expect.objectContaining({ path: '/api/v1/camera/0/connected', method: 'GET' }),
      expect.objectContaining({
        path: '/api/v1/camera/0/connected',
        method: 'PUT',
        contentType: 'application/x-www-form-urlencoded',
        body: 'Connected=true',
      }),
      expect.objectContaining({ path: '/api/v1/camera/0/connected', method: 'GET' }),
    ])
  })

  it('treats an already-connected ASCOM-like device as success without issuing a write', async () => {
    const requests: RecordedRequest[] = []
    const alpaca = provider([inventory, envelope(true)], requests)

    await expect(alpaca.connectDevice('camera-1')).resolves.toEqual({
      outcome: 'connected',
      command: 'not-needed',
    })
    expect(requests).toHaveLength(2)
    expect(requests.every(({ method }) => method === 'GET')).toBe(true)
  })

  it('fails an unknown stable device identity before reaching a device endpoint', async () => {
    const requests: RecordedRequest[] = []
    const alpaca = provider([inventory], requests)

    await expect(alpaca.connectDevice('unknown-device')).resolves.toEqual({
      outcome: 'failed',
      reason: 'device-not-found',
    })
    expect(requests).toHaveLength(1)
  })

  it('observes supported asynchronous completion before confirming the connection', async () => {
    vi.useFakeTimers()
    const { alpaca } = connectingProvider(20)

    const connection = alpaca.connectDevice('camera-1')
    await vi.advanceTimersByTimeAsync(30)

    await expect(connection).resolves.toEqual({ outcome: 'connected', command: 'requested' })
  })

  it('stops bounded asynchronous verification without replaying the write', async () => {
    vi.useFakeTimers()
    const { alpaca, fetch } = connectingProvider(Infinity)

    const connection = alpaca.connectDevice('camera-1')
    await vi.advanceTimersByTimeAsync(30)

    await expect(connection).resolves.toEqual({
      outcome: 'uncertain',
      reason: 'verification-timeout',
    })
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1)
  })

  it('returns a confirmed failure when the provider rejects the write', async () => {
    const alpaca = provider([
      inventory,
      envelope(false),
      methodEnvelope(1025, 'Invalid connection request'),
    ])

    await expect(alpaca.connectDevice('camera-1')).resolves.toEqual({
      outcome: 'failed',
      reason: 'rejected',
      message: 'Invalid connection request',
      errorNumber: 1025,
    })
  })

  it('preserves a decoded protocol rejection when cancellation races with the response', async () => {
    const controller = new AbortController()

    const rejectThenCancel: ResponseFactory = async () => {
      queueMicrotask(() => controller.abort(new DOMException('Cancelled', 'AbortError')))

      return Response.json(methodEnvelope(1025, 'Invalid connection request'))
    }

    const alpaca = provider([inventory, envelope(false), rejectThenCancel])

    await expect(alpaca.connectDevice('camera-1', { signal: controller.signal })).resolves.toEqual({
      outcome: 'failed',
      reason: 'rejected',
      message: 'Invalid connection request',
      errorNumber: 1025,
    })
  })

  it('returns a confirmed failure when a successful legacy write remains disconnected', async () => {
    const alpaca = provider([
      inventory,
      envelope(false),
      methodEnvelope(),
      envelope(false),
      unsupportedConnecting,
    ])

    await expect(alpaca.connectDevice('camera-1')).resolves.toEqual({
      outcome: 'failed',
      reason: 'remained-disconnected',
    })
  })

  it('rejects malformed pre-write state without issuing a command', async () => {
    const requests: RecordedRequest[] = []
    const alpaca = provider([inventory, envelope('false')], requests)

    await expect(alpaca.connectDevice('camera-1')).rejects.toMatchObject({
      name: 'AlpacaProviderError',
      reason: 'invalid-response',
    })
    expect(requests).toHaveLength(2)
  })

  it('does not treat a bare HTTP error as confirmed rejection after a physical write', async () => {
    const alpaca = provider([
      inventory,
      envelope(false),
      new Response('Server error', { status: 500 }),
      envelope(false),
      unsupportedConnecting,
    ])

    await expect(alpaca.connectDevice('camera-1')).resolves.toEqual({
      outcome: 'uncertain',
      reason: 'write-outcome-unknown',
    })
  })

  it('reconciles an ambiguous write response when the device is observably connected', async () => {
    const alpaca = provider([inventory, envelope(false), {}, envelope(true)])

    await expect(alpaca.connectDevice('camera-1')).resolves.toEqual({
      outcome: 'connected',
      command: 'requested',
    })
  })

  it('reports an uncertain outcome when a malformed write response cannot be reconciled', async () => {
    const alpaca = provider([
      inventory,
      envelope(false),
      {},
      envelope(false),
      unsupportedConnecting,
    ])

    await expect(alpaca.connectDevice('camera-1')).resolves.toEqual({
      outcome: 'uncertain',
      reason: 'write-outcome-unknown',
    })
  })

  it('times out before the write without issuing a command', async () => {
    vi.useFakeTimers()
    const requests: RecordedRequest[] = []
    const alpaca = provider([inventory, stalledRequest], requests)

    const connection = alpaca.connectDevice('camera-1')
    const rejection = expect(connection).rejects.toBeInstanceOf(AlpacaProviderError)
    await vi.advanceTimersByTimeAsync(20)

    await rejection
    expect(requests).toHaveLength(2)
  })

  it('does not replay a response-less write and reports the unresolved outcome', async () => {
    vi.useFakeTimers()
    const requests: RecordedRequest[] = []

    const alpaca = provider(
      [inventory, envelope(false), stalledRequest, envelope(false), unsupportedConnecting],
      requests,
    )

    const connection = alpaca.connectDevice('camera-1')
    await vi.advanceTimersByTimeAsync(20)

    await expect(connection).resolves.toEqual({
      outcome: 'uncertain',
      reason: 'write-outcome-unknown',
    })
    expect(requests.filter(({ method }) => method === 'PUT')).toHaveLength(1)
  })

  it('reports unavailable verification when the post-write read receives no response', async () => {
    vi.useFakeTimers()

    const alpaca = provider([inventory, envelope(false), methodEnvelope(), stalledRequest])

    const connection = alpaca.connectDevice('camera-1')
    await vi.advanceTimersByTimeAsync(20)

    await expect(connection).resolves.toEqual({
      outcome: 'uncertain',
      reason: 'verification-unavailable',
    })
  })

  it('cancels before a write without hiding that no command was sent', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('Cancelled', 'AbortError'))
    const requests: RecordedRequest[] = []
    const alpaca = provider([], requests)

    await expect(
      alpaca.connectDevice('camera-1', { signal: controller.signal }),
    ).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(requests).toHaveLength(0)
  })

  it('reports uncertainty when cancellation occurs after a confirmed write', async () => {
    const controller = new AbortController()

    const cancelDuringVerification: ResponseFactory = signal => {
      const request = stalledRequest(signal)
      queueMicrotask(() => controller.abort(new DOMException('Cancelled', 'AbortError')))

      return request
    }

    const alpaca = provider([
      inventory,
      envelope(false),
      methodEnvelope(),
      cancelDuringVerification,
    ])

    await expect(alpaca.connectDevice('camera-1', { signal: controller.signal })).resolves.toEqual({
      outcome: 'uncertain',
      reason: 'cancelled',
    })
  })

  it('reports uncertainty when cancellation occurs during the write', async () => {
    const controller = new AbortController()
    const requests: RecordedRequest[] = []

    const cancelDuringWrite: ResponseFactory = signal => {
      const request = stalledRequest(signal)
      queueMicrotask(() => controller.abort(new DOMException('Cancelled', 'AbortError')))

      return request
    }

    const alpaca = provider([inventory, envelope(false), cancelDuringWrite], requests)

    const connection = alpaca.connectDevice('camera-1', { signal: controller.signal })

    await expect(connection).resolves.toEqual({ outcome: 'uncertain', reason: 'cancelled' })
    expect(requests.filter(({ method }) => method === 'PUT')).toHaveLength(1)
  })
})
