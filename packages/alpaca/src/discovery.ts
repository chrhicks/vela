import type {
  AlpacaDiscovery,
  AlpacaDiscoveryOptions,
  AlpacaEndpoint,
  AlpacaInspectOptions,
  AlpacaInspection,
  AlpacaInspectionDevice,
  AlpacaScanOptions,
  AlpacaUdpScanner,
} from './discovery-model.js'
import { createAlpacaClient } from './internal/client.js'
import {
  normalizeConfiguredDevices,
  rejectDuplicateDeviceIds,
  stableDeviceId,
} from './internal/configured-device.js'
import { toDeviceKind } from './internal/device-kind.js'
import { createNodeUdpScanner } from './internal/udp-scanner.js'

const defaultScanDurationMs = 1_000
const defaultScanAttempts = 2
const defaultRequestTimeoutMs = 3_000

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`)
  }
  return value
}

function endpointBaseUrl(endpoint: AlpacaEndpoint): string {
  const host = endpoint.host.trim()
  if (host.length === 0) {
    throw new RangeError('Alpaca endpoint host must not be empty')
  }
  positiveInteger(endpoint.port, 'Alpaca endpoint port')
  if (endpoint.port > 65535) {
    throw new RangeError('Alpaca endpoint port must not exceed 65535')
  }
  return `http://${host}:${endpoint.port}`
}

export function createAlpacaDiscovery({
  fetch = globalThis.fetch,
  udpScanner = createNodeUdpScanner(),
}: AlpacaDiscoveryOptions = {}): AlpacaDiscovery {
  async function scan(options: AlpacaScanOptions = {}): Promise<ReadonlyArray<AlpacaEndpoint>> {
    const durationMs = positiveInteger(
      options.durationMs ?? defaultScanDurationMs,
      'Scan duration',
    )
    const attempts = positiveInteger(options.attempts ?? defaultScanAttempts, 'Scan attempts')

    return udpScanner.scan({
      durationMs,
      attempts,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.interfaceAddresses === undefined
        ? {}
        : { interfaceAddresses: options.interfaceAddresses }),
    })
  }

  async function inspect(
    endpoint: AlpacaEndpoint,
    options: AlpacaInspectOptions = {},
  ): Promise<AlpacaInspection> {
    const requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs ?? defaultRequestTimeoutMs,
      'Inspection request timeout',
    )
    const client = createAlpacaClient({
      baseUrl: endpointBaseUrl(endpoint),
      fetch,
      requestTimeoutMs,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })

    // Management operations remain serial for compatibility with finicky servers.
    const apiVersions = await client.apiVersions()
    const description = await client.serverDescription()
    const configuredDevices = normalizeConfiguredDevices(
      await client.configuredDevices(),
    )
    rejectDuplicateDeviceIds(configuredDevices)

    const devices: AlpacaInspectionDevice[] = configuredDevices.map((device) => {
      const providerDeviceId = stableDeviceId(device)
      return {
        kind: toDeviceKind(device.DeviceType),
        name: device.DeviceName,
        ...(providerDeviceId === undefined || providerDeviceId.length === 0
          ? {}
          : { providerDeviceId }),
      }
    })

    return {
      endpoint: { host: endpoint.host.trim(), port: endpoint.port },
      apiVersions,
      server: {
        ...(description.ServerName === undefined ? {} : { name: description.ServerName }),
        ...(description.Manufacturer === undefined
          ? {}
          : { manufacturer: description.Manufacturer }),
        ...(description.ManufacturerVersion === undefined
          ? {}
          : { manufacturerVersion: description.ManufacturerVersion }),
        ...(description.Location === undefined ? {} : { location: description.Location }),
      },
      devices,
    }
  }

  return { scan, inspect }
}

export type { AlpacaUdpScanner }
