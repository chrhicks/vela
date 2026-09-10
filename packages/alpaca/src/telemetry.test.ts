import { afterEach, expect, it } from 'vitest'
import { context, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node'
import { createAlpacaAcquisition } from './acquisition.js'
import { createAlpacaClient } from './internal/client.js'

let provider: NodeTracerProvider | undefined
function recording() {
  const exporter = new InMemorySpanExporter()
  provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] })
  provider.register()
  return exporter
}

afterEach(async () => {
  await provider?.shutdown()
  provider = undefined
  trace.disable()
  context.disable()
})

const telescope = { DeviceName: 'Mount', DeviceType: 'Telescope', DeviceNumber: 0, UniqueID: 'mount' }
const envelope = (Value: unknown, ErrorNumber = 0) => ({ ClientTransactionID: 7, ServerTransactionID: 23, ErrorNumber, ErrorMessage: ErrorNumber ? 'Device rejected command' : '', Value })

it('keeps tracing optional when no SDK provider is registered', async () => {
  const client = createAlpacaClient({ baseUrl: 'http://fake', fetch: async () => Response.json(envelope(12)) })
  await expect(client.readNumber(telescope, 'rightascension')).resolves.toBe(12)
  expect(trace.getActiveSpan()).toBeUndefined()
})

it('keeps the ALPACA span open through headers, body and value validation', async () => {
  const exporter = recording()
  let sendHeaders!: (response: Response) => void
  let sendBody!: (body: unknown) => void
  let readingBody!: () => void
  const bodyStarted = new Promise<void>(resolve => { readingBody = resolve })
  const client = createAlpacaClient({ baseUrl: 'http://fake', fetch: async () => new Promise<Response>(resolve => { sendHeaders = resolve }) })
  const read = client.readNumber(telescope, 'rightascension')
  expect(exporter.getFinishedSpans()).toHaveLength(0)
  const response = Response.json({})
  response.json = () => new Promise(resolve => { sendBody = resolve; readingBody() })
  sendHeaders(response)
  await bodyStarted
  expect(exporter.getFinishedSpans()).toHaveLength(0)
  sendBody(envelope(12))
  await expect(read).resolves.toBe(12)
  const span = exporter.getFinishedSpans()[0]!
  expect(span.kind).toBe(SpanKind.CLIENT)
  expect(span.status.code).toBe(SpanStatusCode.OK)
  expect(span.attributes).toMatchObject({
    'http.request.method': 'GET', 'url.path': '/api/v1/telescope/0/rightascension',
    'server.address': 'fake', 'url.scheme': 'http',
    'http.response.status_code': 200, 'alpaca.operation': 'rightascension',
    'alpaca.device.type': 'telescope', 'alpaca.device.number': 0,
    'alpaca.client_transaction_id': 7, 'alpaca.server_transaction_id': 23,
    'alpaca.response.value': 12, 'alpaca.error_number': 0,
  })
  expect(span.attributes['alpaca.response.headers_ms']).toEqual(expect.any(Number))
  expect(span.attributes['alpaca.response.body_ms']).toEqual(expect.any(Number))
  expect(span.events.map(event => event.name)).toEqual(expect.arrayContaining([
    'alpaca.request.dispatched', 'alpaca.response.headers', 'alpaca.response.body', 'alpaca.response.decode',
  ]))
})

it('marks HTTP 200 protocol errors and malformed values as errors, including binary image envelopes', async () => {
  const exporter = recording()
  const command = createAlpacaClient({ baseUrl: 'http://fake', fetch: async () => Response.json(envelope(undefined, 1025)) })
  await expect(command.command(telescope, 'moveaxis', { Axis: '0', Rate: '0' })).rejects.toMatchObject({ errorNumber: 1025 })
  const malformed = createAlpacaClient({ baseUrl: 'http://fake', fetch: async () => Response.json(envelope('not a number')) })
  await expect(malformed.readNumber(telescope, 'rightascension')).rejects.toMatchObject({ reason: 'invalid-response' })

  const bytes = new ArrayBuffer(44)
  const metadata = new DataView(bytes)
  metadata.setInt32(0, 1, true)
  metadata.setInt32(4, 1025, true)
  metadata.setUint32(8, 0xffffffff, true)
  metadata.setUint32(12, 42, true)
  metadata.setInt32(16, 44, true)
  const image = createAlpacaClient({ baseUrl: 'http://fake', fetch: async () => new Response(bytes, { headers: { 'content-type': 'application/imagebytes' } }) })
  await expect(image.image(telescope)).rejects.toMatchObject({ errorNumber: 1025 })
  const spans = exporter.getFinishedSpans()
  expect(spans).toHaveLength(3)
  for (const span of spans) {
    expect(span.status.code).toBe(SpanStatusCode.ERROR)
    expect(span.attributes['http.response.status_code']).toBe(200)
    expect(span.events.some(event => event.name === 'exception')).toBe(true)
    for (const key of ['body', 'pixels', 'Value']) expect(span.attributes).not.toHaveProperty(key)
  }
  expect(spans[0]!.attributes).toMatchObject({ 'alpaca.error_number': 1025, 'alpaca.command.rate': '0', 'alpaca.command.axis': '0' })
  expect(spans[1]!.attributes['alpaca.failure.reason']).toBe('invalid-response')
  expect(spans[2]!.attributes).toMatchObject({ 'alpaca.error_number': 1025, 'alpaca.client_transaction_id': 0xffffffff, 'alpaca.server_transaction_id': 42 })
})

it.each([false, true])('correlates rotation requests and independent confirmed cleanup (cancel=%s)', async cancel => {
  const exporter = recording()
  let moving = false
  let reading!: () => void
  const pendingRead = new Promise<void>(resolve => { reading = resolve })
  const controller = new AbortController()
  const writes: string[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const operation = new URL(String(input)).pathname.split('/').at(-1)
    let value: unknown = true
    if (operation === 'configureddevices') value = [telescope]
    if (operation === 'axisrates') value = [{ Minimum: 0, Maximum: 3 }]
    if (operation === 'slewing') value = moving
    if (operation === 'rightascension') {
      value = moving ? 11.99 : 12
      if (moving && cancel) {
        return new Promise<Response>((_, reject) => {
          init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true })
          reading()
        })
      }
    }
    if (operation === 'moveaxis') {
      const rate = new URLSearchParams(String(init?.body)).get('Rate')!
      writes.push(rate)
      moving = rate !== '0'
      expect(init?.signal?.aborted).toBe(false)
    }
    return Response.json(envelope(value))
  }
  const acquisition = createAlpacaAcquisition({ baseUrl: 'http://fake', fetch })
  const result = trace.getTracer('test').startActiveSpan('alignment.move', async span => {
    try { await acquisition.rotateRightAscension('mount', 3, -0.1, controller.signal) }
    finally { span.end() }
  })
  if (cancel) {
    const reason = new Error('Operator cancelled alignment')
    const rejected = expect(result).rejects.toBe(reason)
    await pendingRead
    expect(exporter.getFinishedSpans().some(span => span.attributes['alpaca.command.rate'] === '3')).toBe(true)
    expect(exporter.getFinishedSpans().some(span => span.name === 'alpaca.rotate_right_ascension')).toBe(false)
    controller.abort(reason)
    await rejected
  } else await result
  expect(writes).toEqual(['3', '0'])
  const spans = exporter.getFinishedSpans()
  const parent = spans.find(span => span.name === 'alignment.move')!
  const rotation = spans.find(span => span.name === 'alpaca.rotate_right_ascension')!
  expect(rotation.parentSpanContext?.spanId).toBe(parent.spanContext().spanId)
  expect(rotation.status.code).toBe(cancel ? SpanStatusCode.ERROR : SpanStatusCode.OK)
  const requests = spans.filter(span => span.kind === SpanKind.CLIENT)
  expect(requests.every(span => span.spanContext().traceId === parent.spanContext().traceId)).toBe(true)
  expect(requests.every(span => span.parentSpanContext?.spanId === rotation.spanContext().spanId)).toBe(true)
  const stop = requests.find(span => span.attributes['alpaca.command.rate'] === '0')!
  expect(stop.status.code).toBe(SpanStatusCode.OK)
  expect(rotation.events.map(event => event.name)).toEqual(expect.arrayContaining(['alpaca.stop.requested', 'alpaca.stop.acknowledged', 'alpaca.stop.confirmed']))
  expect(rotation.events.some(event => event.name === 'alpaca.rotation.threshold')).toBe(!cancel)
})
