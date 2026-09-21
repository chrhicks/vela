import { Schema } from 'effect'
import { afterEach, expect, it, vi } from 'vitest'
import { createAlpacaClient, type AlpacaClient } from './client.js'

const camera = { DeviceName: 'Camera', DeviceType: 'Camera', DeviceNumber: 0, UniqueID: 'camera' }

const envelope = { ClientTransactionID: 0, ServerTransactionID: 1, ErrorNumber: 0, ErrorMessage: '' }

// The consumer must actually request bytes before a test terminates the stream.
function pendingBody(contentType: string) {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  let reading!: () => void
  const started = new Promise<void>(resolve => { reading = resolve })

  const response = new Response(new ReadableStream<Uint8Array>({
    start(value) { controller = value },
    pull() { reading() },
  }, { highWaterMark: 0 }), { headers: { 'content-type': contentType } })

  return { response, controller, started }
}

const operations = [
  { name: 'management inventory', path: '/management/v1/configureddevices', method: 'GET', contentType: 'application/json', run: (client: AlpacaClient) => client.configuredDevices() },
  { name: 'ImageReady observation', path: '/api/v1/camera/0/imageready', method: 'GET', contentType: 'application/json', run: (client: AlpacaClient) => client.readBoolean(camera, 'imageready') },
  { name: 'StartExposure acknowledgement', path: '/api/v1/camera/0/startexposure', method: 'PUT', contentType: 'application/json', run: (client: AlpacaClient) => client.command(camera, 'startexposure', { Duration: '1', Light: 'true' }) },
  { name: 'JSON ImageArray', path: '/api/v1/camera/0/imagearray', method: 'GET', contentType: 'application/json', run: (client: AlpacaClient) => client.image(camera) },
  { name: 'ImageBytes ImageArray', path: '/api/v1/camera/0/imagearray', method: 'GET', contentType: 'application/imagebytes', run: (client: AlpacaClient) => client.image(camera) },
]

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it.each(operations)('classifies a terminated $name body as transport without repeating the request', async operation => {
  const body = pendingBody(operation.contentType)
  const socketError = new Error('socket closed', { cause: new Error('ECONNRESET') })
  const termination = new TypeError('terminated', { cause: socketError })

  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(new URL(String(input)).pathname).toBe(operation.path)
    expect(init?.method ?? 'GET').toBe(operation.method)

    if (operation.method === 'PUT') {
      expect(new Headers(init?.headers).get('content-type')).toBe('application/x-www-form-urlencoded')
      expect(String(init?.body)).toBe('Duration=1&Light=true')
    }

    return body.response
  })

  const client = createAlpacaClient({ baseUrl: 'http://fake', fetch })
  const result = operation.run(client)
  const failed = expect(result).rejects.toMatchObject({ reason: 'transport', endpoint: operation.path, cause: termination })
  await body.started
  body.controller.enqueue(new TextEncoder().encode('{"partial":'))
  body.controller.error(termination)
  await failed
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('does not depend on the stream error being a TypeError', async () => {
  const body = pendingBody('application/json')
  const cause = new Error('connection reset')
  const client = createAlpacaClient({ baseUrl: 'http://fake', fetch: async () => body.response })
  const failed = expect(client.connected(camera)).rejects.toMatchObject({ reason: 'transport', cause })
  await body.started
  body.controller.error(cause)
  await failed
})

it('accepts a complete chunked JSON body and retains schema validation', async () => {
  const body = pendingBody('application/json')
  const client = createAlpacaClient({ baseUrl: 'http://fake', fetch: async () => body.response })
  const result = client.readBoolean(camera, 'imageready')
  await body.started
  const json = JSON.stringify({ ...envelope, Value: true })
  body.controller.enqueue(new TextEncoder().encode(json.slice(0, 15)))
  body.controller.enqueue(new TextEncoder().encode(json.slice(15)))
  body.controller.close()
  await expect(result).resolves.toBe(true)
})

it.each([
  { name: 'malformed JSON', payload: '{"Value":', cause: SyntaxError },
  { name: 'wrong value schema', payload: JSON.stringify({ ...envelope, Value: 'true' }), cause: Error },
  { name: 'wrong envelope schema', payload: JSON.stringify({ Value: true }), cause: Error },
])('classifies completed $name as invalid-response with its cause', async ({ payload, cause }) => {
  const client = createAlpacaClient({ baseUrl: 'http://fake', fetch: async () => new Response(payload) })
  await expect(client.readBoolean(camera, 'imageready')).rejects.toMatchObject({ reason: 'invalid-response', cause: expect.any(cause) })
})

it('does not mistake a decoder TypeError for a stream failure', async () => {
  const cause = new TypeError('decoder bug')
  const schema = Schema.Boolean.check(Schema.makeFilter(() => { throw cause }))
  const client = createAlpacaClient({ baseUrl: 'http://fake', fetch: async () => Response.json({ ...envelope, Value: true }) })
  await expect(client.readValue(camera, 'imageready', schema)).rejects.toMatchObject({ reason: 'invalid-response', cause })
})

it.each([
  { contentType: 'application/json', payload: '{"Value":' },
  { contentType: 'application/json', payload: JSON.stringify({ ...envelope, Type: 2, Rank: 3, Value: [[1]] }) },
  { contentType: 'application/imagebytes', payload: new Uint8Array(43) },
])('keeps malformed completed image data invalid ($contentType)', async ({ contentType, payload }) => {
  const client = createAlpacaClient({ baseUrl: 'http://fake', fetch: async () => new Response(payload, { headers: { 'content-type': contentType } }) })
  await expect(client.image(camera)).rejects.toMatchObject({ reason: 'invalid-response' })
})

it.each(['application/json', 'application/imagebytes'])('preserves caller cancellation during a %s image body', async contentType => {
  const body = pendingBody(contentType)
  const caller = new AbortController()
  const reason = new Error('Stop requested')

  const fetch: typeof globalThis.fetch = async (_input, init) => {
    init!.signal!.addEventListener('abort', () => body.controller.error(init!.signal!.reason), { once: true })

    return body.response
  }

  const client = createAlpacaClient({ baseUrl: 'http://fake', fetch, requestTimeoutMs: 5_000, imageTimeoutMs: 60_000 })
  const result = client.image(camera, caller.signal)
  const cancelled = expect(result).rejects.toBe(reason)
  await body.started
  caller.abort(reason)
  await cancelled
})

it('times out an ordinary read while its body is pending and preserves the abort cause', async () => {
  vi.useFakeTimers()
  const body = pendingBody('application/json')
  let requestSignal!: AbortSignal

  const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestSignal = init!.signal!
    requestSignal.addEventListener('abort', () => body.controller.error(requestSignal.reason), { once: true })

    return body.response
  })

  const client = createAlpacaClient({ baseUrl: 'http://fake', fetch, requestTimeoutMs: 5_000 })
  const result = client.readBoolean(camera, 'imageready')
  const failed = expect(result).rejects.toMatchObject({ reason: 'transport', message: expect.stringContaining('timed out after 5000ms'), cause: expect.objectContaining({ name: 'TimeoutError' }) })
  await body.started
  await vi.advanceTimersByTimeAsync(4_999)
  expect(requestSignal.aborted).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  await failed
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})
