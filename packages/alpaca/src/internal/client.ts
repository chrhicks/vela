import { Schema } from 'effect'
import { SpanKind, SpanStatusCode, trace, type Span, type Attributes } from '@opentelemetry/api'
import { AlpacaProviderError } from '../error.js'
import { imageBytesMetadata } from './image-bytes.js'
import {
  alpacaMethodResponse,
  connectedResponse,
  driverInfoResponse,
  driverVersionResponse,
} from './types/common.js'
import {
  configuredDevice,
  serverDescription,
  type ConfiguredDevice,
  type ServerDescription,
} from './types/management.js'

export interface AlpacaClient {
  command(device: ConfiguredDevice, operation: string, parameters: Record<string, string>, signal?: AbortSignal): Promise<void>
  readValue<S extends Schema.ConstraintDecoder<unknown>>(device: ConfiguredDevice, operation: string, schema: S, signal?: AbortSignal): Promise<S['Type']>
  image(device: ConfiguredDevice, signal?: AbortSignal): Promise<CameraImage>
  apiVersions(signal?: AbortSignal): Promise<ReadonlyArray<number>>
  serverDescription(signal?: AbortSignal): Promise<ServerDescription>
  configuredDevices(signal?: AbortSignal): Promise<ReadonlyArray<ConfiguredDevice>>
  connected(device: ConfiguredDevice, signal?: AbortSignal): Promise<boolean>
  connecting(device: ConfiguredDevice, signal?: AbortSignal): Promise<boolean>
  setConnected(device: ConfiguredDevice, signal?: AbortSignal): Promise<void>
  driverInfo(device: ConfiguredDevice, signal?: AbortSignal): Promise<string>
  driverVersion(device: ConfiguredDevice, signal?: AbortSignal): Promise<string>
  readBoolean(device: ConfiguredDevice, operation: string, signal?: AbortSignal): Promise<boolean>
  readNumber(device: ConfiguredDevice, operation: string, signal?: AbortSignal): Promise<number>
  readString(device: ConfiguredDevice, operation: string, signal?: AbortSignal): Promise<string>
  readStrings(device: ConfiguredDevice, operation: string, signal?: AbortSignal): Promise<ReadonlyArray<string>>
}

export interface AlpacaClientOptions {
  baseUrl: string
  fetch: typeof globalThis.fetch
  signal?: AbortSignal
  requestTimeoutMs?: number
  imageTimeoutMs?: number
}

interface AlpacaResult {
  ClientTransactionID: number
  ServerTransactionID: number
  ErrorNumber: number
  ErrorMessage: string
}

export const cameraImage = Schema.Struct({
  Rank: Schema.Literal(2),
  Type: Schema.Literal(2),
  Value: Schema.Array(Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: -2147483648, maximum: 2147483647 })))),
})

export type CameraImage = typeof cameraImage.Type | ArrayBuffer

export function createAlpacaClient({
  baseUrl,
  fetch,
  signal,
  requestTimeoutMs,
  imageTimeoutMs = requestTimeoutMs,
}: AlpacaClientOptions): AlpacaClient {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '')
  const address = URL.canParse(normalizedBaseUrl) ? new URL(normalizedBaseUrl) : undefined
  const apiBasePath = '/api/v1'
  const managementBasePath = '/management/v1'

  function tracedRequest<T>(endpoint: string, method: 'GET' | 'PUT', operation: (span: Span) => Promise<T>): Promise<T> {
    const path = endpoint.split('?')[0]!
    const parts = path.split('/')

    const attributes: Attributes = {
      'http.request.method': method,
      'url.path': path,
      'alpaca.operation': parts.at(-1)!,
    }

    if (address !== undefined) {
      attributes['server.address'] = address.hostname
      attributes['url.scheme'] = address.protocol.slice(0, -1)

      if (address.port) attributes['server.port'] = Number(address.port)
    }

    if (parts[1] === 'api') {
      attributes['alpaca.device.type'] = parts[3]!
      attributes['alpaca.device.number'] = Number(parts[4])
    }

    return trace.getTracer('@vela/alpaca').startActiveSpan(`alpaca.${method.toLowerCase()} ${path}`, { kind: SpanKind.CLIENT, attributes }, async span => {
      try {
        const result = await operation(span)
        span.setStatus({ code: SpanStatusCode.OK })

        return result
      } catch (error) {
        if (error instanceof AlpacaProviderError) {
          span.setAttribute('alpaca.failure.reason', error.reason)

          if (error.errorNumber !== undefined) span.setAttribute('alpaca.error_number', error.errorNumber)
        }

        span.recordException(error instanceof Error ? error : String(error))
        span.setStatus({ code: SpanStatusCode.ERROR })
        throw error
      } finally {
        span.end()
      }
    })
  }

  async function request<S extends Schema.ConstraintDecoder<unknown>>(
    endpoint: string,
    schema: S,
    operationSignal = signal,
    init?: Omit<RequestInit, 'signal'>,
    timeoutMs = requestTimeoutMs,
    bodyFormat: 'json' | 'image' = 'json',
  ): Promise<S['Type']> {
    const controller = new AbortController()
    const span = trace.getActiveSpan()
    let timedOut = false

    const onAbort = () => controller.abort(operationSignal === undefined ? undefined : (operationSignal.reason ?? new DOMException('The operation was aborted', 'AbortError')))

    if (operationSignal?.aborted) {
      onAbort()
    } else {
      operationSignal?.addEventListener('abort', onAbort, { once: true })
    }

    const timeout = timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true
          controller.abort(new DOMException('The request timed out', 'TimeoutError'))
        }, timeoutMs)

    function throwTransportError(cause: unknown): never {
      if (operationSignal?.aborted) {
        throw (operationSignal.reason ?? new DOMException('The operation was aborted', 'AbortError'))
      }

      if (timedOut) {
        throw new AlpacaProviderError(
          `Alpaca endpoint ${endpoint} timed out after ${timeoutMs}ms`,
          {
            reason: 'transport',
            endpoint,
            cause,
          },
        )
      }

      throw new AlpacaProviderError(`Unable to reach Alpaca endpoint ${endpoint}`, {
        reason: 'transport',
        endpoint,
        cause,
      })
    }

    try {
      let response: Response

      try {
        const dispatchedAt = performance.now()
        span?.addEvent('alpaca.request.dispatched')
        response = await fetch(`${normalizedBaseUrl}${endpoint}`, {
          ...init,
          signal: controller.signal,
        })
        span?.setAttributes({ 'http.response.status_code': response.status, 'alpaca.response.headers_ms': performance.now() - dispatchedAt })
        span?.addEvent('alpaca.response.headers')
      } catch (cause) {
        throwTransportError(cause)
      }

      if (!response.ok) {
        throw new AlpacaProviderError(
          `Alpaca endpoint ${endpoint} returned HTTP ${response.status}`,
          {
            reason: 'protocol-error',
            endpoint,
          },
        )
      }

      let binary = false

      if (bodyFormat === 'image') {
        const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
        binary = contentType === 'application/imagebytes'

        if (!binary && contentType !== 'application/json') {
          throw new AlpacaProviderError('Unsupported camera image Content-Type', { reason: 'invalid-response', endpoint })
        }
      }

      const bodyStartedAt = performance.now()
      let json: unknown

      if (binary) {
        try {
          json = await response.arrayBuffer()
        } catch (cause) {
          throwTransportError(cause)
        }
      } else {
        let text: string

        try {
          text = await response.text()
        } catch (cause) {
          throwTransportError(cause)
        }

        try {
          json = JSON.parse(text)
        } catch (cause) {
          throw new AlpacaProviderError(`Alpaca endpoint ${endpoint} returned an invalid response body`, {
            reason: 'invalid-response',
            endpoint,
            cause,
          })
        }
      }

      // Keep body timing inclusive of JSON parsing, as with Response.json().
      span?.setAttribute('alpaca.response.body_ms', performance.now() - bodyStartedAt)
      span?.addEvent('alpaca.response.body')

      return decodeResponse(endpoint, schema)(json)
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout)
      }

      operationSignal?.removeEventListener('abort', onAbort)
    }
  }

  function rejectProtocolError(endpoint: string, response: AlpacaResult): void {
    trace.getActiveSpan()?.setAttributes({
      'alpaca.client_transaction_id': response.ClientTransactionID,
      'alpaca.server_transaction_id': response.ServerTransactionID,
      'alpaca.error_number': response.ErrorNumber,
    })

    if (response.ErrorNumber === 0) return

    throw new AlpacaProviderError(
      response.ErrorMessage || `Alpaca protocol error ${response.ErrorNumber}`,
      {
        reason: 'protocol-error',
        endpoint,
        errorNumber: response.ErrorNumber,
      },
    )
  }

  function decodeResponse<S extends Schema.ConstraintDecoder<unknown>>(
    endpoint: string,
    schema: S,
  ): ReturnType<typeof Schema.decodeUnknownSync<S>> {
    return value => {
      const startedAt = performance.now()

      try {
        return Schema.decodeUnknownSync(schema)(value)
      } catch (cause) {
        throw new AlpacaProviderError(`Alpaca endpoint ${endpoint} returned an invalid response`, {
          reason: 'invalid-response',
          endpoint,
          cause,
        })
      } finally {
        trace.getActiveSpan()?.addEvent('alpaca.response.decode', { 'alpaca.decode.duration_ms': performance.now() - startedAt })
      }
    }
  }

  async function requestValue<S extends Schema.ConstraintDecoder<unknown>>(
    endpoint: string,
    valueSchema: S,
    operationSignal?: AbortSignal,
  ): Promise<S['Type']> {
    return tracedRequest(endpoint, 'GET', async () => {
      const value = await request(endpoint, Schema.Unknown, operationSignal)
      const result = decodeResponse(endpoint, alpacaMethodResponse)(value)
      rejectProtocolError(endpoint, result)

      const envelope = decodeResponse(endpoint, Schema.Struct({ Value: Schema.Unknown }))(value)
      const decoded = decodeResponse(endpoint, valueSchema)(envelope.Value)

      if (['rightascension', 'declination', 'slewing', 'tracking'].includes(endpoint.split('/').at(-1)!)
        && Schema.is(Schema.Union([Schema.Number, Schema.Boolean]))(decoded)) {
        trace.getActiveSpan()?.setAttribute('alpaca.response.value', decoded)
      }

      return decoded
    })
  }

  async function requestCommand(
    endpoint: string,
    body: URLSearchParams,
    operationSignal?: AbortSignal,
  ): Promise<void> {
    return tracedRequest(endpoint, 'PUT', async span => {
      // Only the motion arguments needed to distinguish start and stop are
      // recorded. Never copy arbitrary command bodies or image payloads.
      if (endpoint.endsWith('/moveaxis')) {
        for (const key of ['Axis', 'Rate']) {
          const value = body.get(key)

          if (value !== null) span.setAttribute(`alpaca.command.${key.toLowerCase()}`, value)
        }
      }

      const response = await request(
        endpoint,
        alpacaMethodResponse,
        operationSignal,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
        },
      )

      rejectProtocolError(endpoint, response)
    })
  }

  function deviceEndpoint(device: ConfiguredDevice, operation: string): string {
    return `${apiBasePath}/${device.DeviceType.toLowerCase()}/${device.DeviceNumber}/${operation}`
  }

  return {
    command: (device, operation, parameters, operationSignal) =>
      requestCommand(deviceEndpoint(device, operation), new URLSearchParams(parameters), operationSignal),

    readValue: (device, operation, schema, operationSignal) =>
      requestValue(deviceEndpoint(device, operation), schema, operationSignal),

    image: async (device, operationSignal) => {
      const endpoint = deviceEndpoint(device, 'imagearray')

      return tracedRequest(endpoint, 'GET', async span => {
        const value = await request(endpoint, Schema.Unknown, operationSignal,
          { headers: { accept: 'application/imagebytes, application/json;q=0.9' } }, imageTimeoutMs, 'image')

        if (value instanceof ArrayBuffer) {
          if (value.byteLength >= 16) {
            const metadata = new DataView(value)
            span.setAttributes({ 'alpaca.client_transaction_id': metadata.getUint32(8, true), 'alpaca.server_transaction_id': metadata.getUint32(12, true) })
          }

          const decodeStartedAt = performance.now()

          try { imageBytesMetadata(value) }
          finally { span.addEvent('alpaca.response.decode', { 'alpaca.decode.duration_ms': performance.now() - decodeStartedAt }) }

          span.setAttribute('alpaca.error_number', 0)

          return value
        }

        const result = decodeResponse(endpoint, alpacaMethodResponse)(value)
        rejectProtocolError(endpoint, result)

        if (!Schema.is(cameraImage)(value)) {
          throw new AlpacaProviderError('Only rank-2 Int32 camera images are supported', { reason: 'invalid-response', endpoint })
        }

        return value
      })
    },

    apiVersions: (operationSignal) =>
      requestValue('/management/apiversions', Schema.Array(Schema.Int), operationSignal),

    serverDescription: (operationSignal) =>
      requestValue(`${managementBasePath}/description`, serverDescription, operationSignal),

    configuredDevices: (operationSignal) =>
      requestValue(
        `${managementBasePath}/configureddevices`,
        Schema.Array(configuredDevice),
        operationSignal,
      ),

    connected: (device, operationSignal) =>
      requestValue(deviceEndpoint(device, 'connected'), connectedResponse.fields.Value, operationSignal),

    connecting: (device, operationSignal) =>
      requestValue(deviceEndpoint(device, 'connecting'), connectedResponse.fields.Value, operationSignal),

    setConnected: (device, operationSignal) =>
      requestCommand(
        deviceEndpoint(device, 'connected'),
        new URLSearchParams({ Connected: 'true' }),
        operationSignal,
      ),

    driverInfo: (device, operationSignal) =>
      requestValue(deviceEndpoint(device, 'driverinfo'), driverInfoResponse.fields.Value, operationSignal),

    driverVersion: (device, operationSignal) =>
      requestValue(deviceEndpoint(device, 'driverversion'), driverVersionResponse.fields.Value, operationSignal),

    readBoolean: (device, operation, operationSignal) =>
      requestValue(deviceEndpoint(device, operation), Schema.Boolean, operationSignal),

    readNumber: (device, operation, operationSignal) =>
      requestValue(deviceEndpoint(device, operation), Schema.Finite, operationSignal),

    readString: (device, operation, operationSignal) =>
      requestValue(deviceEndpoint(device, operation), Schema.String, operationSignal),

    readStrings: (device, operation, operationSignal) =>
      requestValue(deviceEndpoint(device, operation), Schema.Array(Schema.String), operationSignal),
  }
}
