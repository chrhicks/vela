import { Schema } from 'effect'
import { AlpacaProviderError } from '../error.js'
import {
  alpacaMethodResponse,
  alpacaResponse,
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
}

interface AlpacaResult {
  ErrorNumber: number
  ErrorMessage: string
}

interface AlpacaEnvelope<Value> extends AlpacaResult {
  Value: Value
}

function signalReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
}

export function createAlpacaClient({
  baseUrl,
  fetch,
  signal,
  requestTimeoutMs,
}: AlpacaClientOptions): AlpacaClient {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '')
  const apiBasePath = '/api/v1'
  const managementBasePath = '/management/v1'

  async function request<S extends Schema.ConstraintDecoder<unknown>>(
    endpoint: string,
    schema: S,
    operationSignal = signal,
    init?: Omit<RequestInit, 'signal'>,
  ): Promise<S['Type']> {
    const controller = new AbortController()
    let timedOut = false

    const onAbort = () => controller.abort(operationSignal === undefined ? undefined : signalReason(operationSignal))
    if (operationSignal?.aborted) {
      onAbort()
    } else {
      operationSignal?.addEventListener('abort', onAbort, { once: true })
    }

    const timeout = requestTimeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true
          controller.abort(new DOMException('The request timed out', 'TimeoutError'))
        }, requestTimeoutMs)

    function throwTransportError(cause: unknown): never {
      if (operationSignal?.aborted) {
        throw signalReason(operationSignal)
      }

      if (timedOut) {
        throw new AlpacaProviderError(
          `Alpaca endpoint ${endpoint} timed out after ${requestTimeoutMs}ms`,
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
        response = await fetch(`${normalizedBaseUrl}${endpoint}`, {
          ...init,
          signal: controller.signal,
        })
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

      let json: unknown

      try {
        json = await response.json()
      } catch (cause) {
        if (controller.signal.aborted) {
          throwTransportError(cause)
        }

        throw new AlpacaProviderError(`Alpaca endpoint ${endpoint} returned invalid JSON`, {
          reason: 'invalid-response',
          endpoint,
          cause,
        })
      }

      try {
        return Schema.decodeUnknownSync(schema)(json)
      } catch (cause) {
        throw new AlpacaProviderError(`Alpaca endpoint ${endpoint} returned an invalid response`, {
          reason: 'invalid-response',
          endpoint,
          cause,
        })
      }
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout)
      }
      operationSignal?.removeEventListener('abort', onAbort)
    }
  }

  function rejectProtocolError(endpoint: string, response: AlpacaResult): void {
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
    value: unknown,
  ): S['Type'] {
    try {
      return Schema.decodeUnknownSync(schema)(value)
    } catch (cause) {
      throw new AlpacaProviderError(`Alpaca endpoint ${endpoint} returned an invalid response`, {
        reason: 'invalid-response',
        endpoint,
        cause,
      })
    }
  }

  async function requestValue<S extends Schema.ConstraintDecoder<unknown>>(
    endpoint: string,
    valueSchema: S,
    operationSignal?: AbortSignal,
  ): Promise<S['Type']> {
    const value = await request(endpoint, Schema.Unknown, operationSignal)
    const result = decodeResponse(endpoint, alpacaMethodResponse, value) as AlpacaResult
    rejectProtocolError(endpoint, result)
    const response = decodeResponse(
      endpoint,
      alpacaResponse(valueSchema),
      value,
    ) as unknown as AlpacaEnvelope<S['Type']>
    return response.Value
  }

  async function requestCommand(
    endpoint: string,
    body: URLSearchParams,
    operationSignal?: AbortSignal,
  ): Promise<void> {
    const response = await request(
      endpoint,
      alpacaMethodResponse,
      operationSignal,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      },
    ) as AlpacaResult

    rejectProtocolError(endpoint, response)
  }

  function deviceEndpoint(device: ConfiguredDevice, operation: string): string {
    return `${apiBasePath}/${device.DeviceType.toLowerCase()}/${device.DeviceNumber}/${operation}`
  }

  return {
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
