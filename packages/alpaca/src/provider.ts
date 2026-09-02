import { createAlpacaClient } from './internal/client.js'
import {
  rejectDuplicateDeviceIds,
  stableDeviceId,
} from './internal/configured-device.js'
import { toDeviceKind } from './internal/device-kind.js'
import type { ConfiguredDevice } from './internal/types/management.js'
import type { AlpacaConnectionStatus, AlpacaDevice } from './model.js'

export interface AlpacaProvider {
  listDevices(): Promise<ReadonlyArray<AlpacaDevice>>
}

export interface AlpacaProviderOptions {
  baseUrl: string
  fetch?: typeof globalThis.fetch
  requestTimeoutMs?: number
}

const defaultRequestTimeoutMs = 3_000

export function createAlpacaProvider({
  baseUrl,
  fetch = globalThis.fetch,
  requestTimeoutMs = defaultRequestTimeoutMs,
}: AlpacaProviderOptions): AlpacaProvider {
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new RangeError('Provider request timeout must be a positive integer')
  }
  const client = createAlpacaClient({ baseUrl, fetch, requestTimeoutMs })

  async function connection(device: ConfiguredDevice): Promise<AlpacaConnectionStatus> {
    try {
      return (await client.connected(device)) ? 'connected' : 'disconnected'
    } catch {
      return 'unavailable'
    }
  }

  async function driver(device: ConfiguredDevice): Promise<AlpacaDevice['driver']> {
    let info: string | undefined
    let version: string | undefined

    try {
      info = await client.driverInfo(device)
    } catch {
      // Driver metadata is optional and must not hide an otherwise usable device.
    }

    try {
      version = await client.driverVersion(device)
    } catch {
      // Driver metadata is optional and must not hide an otherwise usable device.
    }

    return {
      ...(info === undefined ? {} : { info }),
      ...(version === undefined ? {} : { version }),
    }
  }

  async function listDevices(): Promise<ReadonlyArray<AlpacaDevice>> {
    const configuredDevices = await client.configuredDevices()
    rejectDuplicateDeviceIds(configuredDevices)
    const devices: AlpacaDevice[] = []

    for (const device of configuredDevices) {
      const providerDeviceId = stableDeviceId(device)
      if (providerDeviceId === undefined) continue

      devices.push({
        providerDeviceId,
        kind: toDeviceKind(device.DeviceType),
        name: device.DeviceName,
        connection: await connection(device),
        driver: await driver(device),
      })
    }

    return devices
  }

  return { listDevices }
}
