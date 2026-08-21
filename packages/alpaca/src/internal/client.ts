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
  type ConfiguredDevice,
} from './types/management.js'

export interface AlpacaClient {
  devices(): Promise<ReadonlyArray<ConfiguredDevice>>
  connected(device: ConfiguredDevice): Promise<boolean>
  driverInfo(device: ConfiguredDevice): Promise<string>
  driverVersion(device: ConfiguredDevice): Promise<string>
}

export interface AlpacaClientOptions {
  baseUrl: string
  fetch: typeof globalThis.fetch
}

interface AlpacaEnvelope<Value> {
  Value: Value
  ErrorNumber: number
  ErrorMessage: string
}

export function createAlpacaClient({ baseUrl, fetch }: AlpacaClientOptions): AlpacaClient {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '')
  const apiBasePath = '/api/v1'
  const managementBasePath = '/management/v1'

  async function request<S extends Schema.ConstraintDecoder<unknown>>(
    endpoint: string,
    schema: S,
  ): Promise<S['Type']> {
    let response: Response

    try {
      response = await fetch(`${normalizedBaseUrl}${endpoint}`)
    } catch (cause) {
      throw new AlpacaProviderError(`Unable to reach Alpaca endpoint ${endpoint}`, {
        reason: 'transport',
        endpoint,
        cause,
      })
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
    devices: () =>
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
