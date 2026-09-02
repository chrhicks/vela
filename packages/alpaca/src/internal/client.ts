import { Schema } from 'effect'
import { AlpacaProviderError } from '../error.js'
import {
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
  apiVersions(): Promise<ReadonlyArray<number>>
  serverDescription(): Promise<ServerDescription>
  configuredDevices(): Promise<ReadonlyArray<ConfiguredDevice>>
  connected(device: ConfiguredDevice): Promise<boolean>
  driverInfo(device: ConfiguredDevice): Promise<string>
  driverVersion(device: ConfiguredDevice): Promise<string>
}

export interface AlpacaClientOptions {
  baseUrl: string
  fetch: typeof globalThis.fetch
  signal?: AbortSignal
  requestTimeoutMs?: number
}

interface AlpacaEnvelope<Value> {
  Value: Value
  ErrorNumber: number
  ErrorMessage: string
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
  ): Promise<S['Type']> {
    const controller = new AbortController()
    let timedOut = false

    const onAbort = () => controller.abort(signal === undefined ? undefined : signalReason(signal))
    if (signal?.aborted) {
      onAbort()
    } else {
      signal?.addEventListener('abort', onAbort, { once: true })
    }

    const timeout = requestTimeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true
          controller.abort(new DOMException('The request timed out', 'TimeoutError'))
        }, requestTimeoutMs)

    function throwTransportError(cause: unknown): never {
      if (signal?.aborted) {
        throw signalReason(signal)
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
          signal: controller.signal,
        })
      } catch (cause) {
        throwTransportError(cause)
      }

      if (!response.ok) {
        throw new AlpacaProviderError(
          `Alpaca endpoint ${endpoint} returned HTTP ${response.status}`,
          {
            reason: 'transport',
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
      signal?.removeEventListener('abort', onAbort)
    }
  }

  async function requestValue<S extends Schema.ConstraintDecoder<unknown>>(
    endpoint: string,
    valueSchema: S,
  ): Promise<S['Type']> {
    const response = await request(
      endpoint,
      alpacaResponse(valueSchema),
    ) as unknown as AlpacaEnvelope<S['Type']>

    if (response.ErrorNumber !== 0) {
      throw new AlpacaProviderError(
        response.ErrorMessage || `Alpaca protocol error ${response.ErrorNumber}`,
        {
          reason: 'protocol-error',
          endpoint,
          errorNumber: response.ErrorNumber,
        },
      )
    }

    return response.Value
  }

  function deviceEndpoint(device: ConfiguredDevice, operation: string): string {
    return `${apiBasePath}/${device.DeviceType.toLowerCase()}/${device.DeviceNumber}/${operation}`
  }

  return {
    apiVersions: () =>
      requestValue('/management/apiversions', Schema.Array(Schema.Int)),

    serverDescription: () =>
      requestValue(`${managementBasePath}/description`, serverDescription),

    configuredDevices: () =>
      requestValue(
        `${managementBasePath}/configureddevices`,
        Schema.Array(configuredDevice),
      ),

    connected: (device) =>
      requestValue(deviceEndpoint(device, 'connected'), connectedResponse.fields.Value),

    driverInfo: (device) =>
      requestValue(deviceEndpoint(device, 'driverinfo'), driverInfoResponse.fields.Value),

    driverVersion: (device) =>
      requestValue(deviceEndpoint(device, 'driverversion'), driverVersionResponse.fields.Value),
  }
}
