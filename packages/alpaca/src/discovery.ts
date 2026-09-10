import type {
  AlpacaDiscovery,
  AlpacaDiscoveryOptions,
  AlpacaEndpoint,
  AlpacaInspectOptions,
  AlpacaInspection,
  AlpacaInspectionDevice,
  AlpacaScanOptions,
  AlpacaUdpScanner,
  AlpacaUdpScanRequest,
} from './discovery-model.js'
import { createAlpacaClient } from './internal/client.js'
import {
  normalizeConfiguredDevices,
  rejectDuplicateDeviceIds,
  stableDeviceId,
} from './internal/configured-device.js'
import { toDeviceKind } from './internal/device-kind.js'
import { createNodeUdpScanner } from './internal/udp-scanner.js'

type Mutable<Value> = { -readonly [Key in keyof Value]: Value[Key] }

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

    const request: Mutable<AlpacaUdpScanRequest> = { durationMs, attempts }

    if (options.signal !== undefined) request.signal = options.signal

    if (options.interfaceAddresses !== undefined) request.interfaceAddresses = options.interfaceAddresses

    return udpScanner.scan(request)
  }

  async function inspect(
    endpoint: AlpacaEndpoint,
    options: AlpacaInspectOptions = {},
  ): Promise<AlpacaInspection> {
    const requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs ?? defaultRequestTimeoutMs,
      'Inspection request timeout',
    )

    const clientOptions: Parameters<typeof createAlpacaClient>[0] = {
      baseUrl: endpointBaseUrl(endpoint),
      fetch,
      requestTimeoutMs,
    }

    if (options.signal !== undefined) clientOptions.signal = options.signal
    const client = createAlpacaClient(clientOptions)

    // Management operations remain serial for compatibility with finicky servers.
    const apiVersions = await client.apiVersions()
    const description = await client.serverDescription()

    const configuredDevices = normalizeConfiguredDevices(
      await client.configuredDevices(),
    )

    rejectDuplicateDeviceIds(configuredDevices)

    const devices: AlpacaInspectionDevice[] = configuredDevices.map((device) => {
      const providerDeviceId = stableDeviceId(device)

      const inspection: Mutable<AlpacaInspectionDevice> = {
        kind: toDeviceKind(device.DeviceType),
        name: device.DeviceName,
      }

      if (providerDeviceId !== undefined && providerDeviceId.length > 0) inspection.providerDeviceId = providerDeviceId

      return inspection
    })

    const server: Mutable<AlpacaInspection['server']> = {}

    if (description.ServerName !== undefined) server.name = description.ServerName

    if (description.Manufacturer !== undefined) server.manufacturer = description.Manufacturer

    if (description.ManufacturerVersion !== undefined) server.manufacturerVersion = description.ManufacturerVersion

    if (description.Location !== undefined) server.location = description.Location

    return {
      endpoint: { host: endpoint.host.trim(), port: endpoint.port },
      apiVersions,
      server,
      devices,
    }
  }

  return { scan, inspect }
}

export type { AlpacaUdpScanner }
