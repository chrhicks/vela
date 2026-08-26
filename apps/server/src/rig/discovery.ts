import { isIPv4 } from 'node:net'
import {
  AlpacaDiscoveryError,
  AlpacaProviderError,
  type AlpacaDiscovery,
  type AlpacaInspection,
} from '@vela/alpaca'
import type {
  DiscoveryCandidateView,
  DiscoveryFailureReason,
  DiscoveryFailureView,
  RigEndpoint,
} from '@vela/model/rig'

const defaultAlpacaPort = 11111

type DiscoverRigsInput =
  | { readonly mode: 'scan' }
  | { readonly mode: 'manual'; readonly endpoint: RigEndpoint }

interface RigDiscoveryFailure {
  readonly view: DiscoveryFailureView
  readonly cause: unknown
}

interface RigDiscoveryResult {
  readonly candidates: ReadonlyArray<DiscoveryCandidateView>
  readonly failures: ReadonlyArray<RigDiscoveryFailure>
}

interface DiscoverRigsOptions {
  readonly alpaca: AlpacaDiscovery
  readonly signal?: AbortSignal
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isHostname(host: string): boolean {
  if (host.length === 0 || host.length > 253 || host !== host.trim()) return false
  if (isIPv4(host)) return true
  if (host.includes('.') && /^[0-9.]+$/.test(host)) return false

  const withoutTrailingDot = host.endsWith('.') ? host.slice(0, -1) : host
  if (withoutTrailingDot.length === 0) return false

  return withoutTrailingDot.split('.').every((label) =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
  )
}

function isPort(port: unknown): port is number {
  return Number.isInteger(port) && Number(port) >= 1 && Number(port) <= 65535
}

export function parseDiscoverRigsInput(value: unknown): DiscoverRigsInput | undefined {
  if (!isRecord(value)) return undefined

  if (value.mode === 'scan') {
    return Object.keys(value).length === 1 ? { mode: 'scan' } : undefined
  }

  if (value.mode !== 'manual' || typeof value.host !== 'string' || !isHostname(value.host)) {
    return undefined
  }

  const keys = Object.keys(value)
  if (keys.some((key) => key !== 'mode' && key !== 'host' && key !== 'port')) {
    return undefined
  }

  const port = value.port ?? defaultAlpacaPort
  if (!isPort(port)) return undefined

  return {
    mode: 'manual',
    endpoint: { host: value.host, port },
  }
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
  }
}

function failureReason(error: AlpacaProviderError): DiscoveryFailureReason {
  switch (error.reason) {
    case 'transport':
      return 'unreachable'
    case 'invalid-response':
      return 'invalid-response'
    case 'protocol-error':
      return 'protocol-error'
  }
}

function hasServerDescription(inspection: AlpacaInspection): boolean {
  return Object.values(inspection.server).some((value) => value !== undefined)
}

function candidateView(inspection: AlpacaInspection): DiscoveryCandidateView {
  const hasStableDevice = inspection.devices.some(
    (device) => device.providerDeviceId !== undefined,
  )

  return {
    endpoint: inspection.endpoint,
    ...(hasServerDescription(inspection) ? { server: inspection.server } : {}),
    inspectedAt: new Date().toISOString(),
    devices: inspection.devices.map((device) => ({
      kind: device.kind,
      name: device.name,
    })),
    disposition: hasStableDevice
      ? { state: 'new' }
      : { state: 'ineligible', reason: 'no-stable-device-id' },
  }
}

export async function discoverRigs(
  input: DiscoverRigsInput,
  { alpaca, signal }: DiscoverRigsOptions,
): Promise<RigDiscoveryResult> {
  throwIfCancelled(signal)
  let endpoints: ReadonlyArray<RigEndpoint>

  if (input.mode === 'manual') {
    endpoints = [input.endpoint]
  } else {
    try {
      endpoints = await alpaca.scan(signal === undefined ? {} : { signal })
    } catch (error) {
      throwIfCancelled(signal)
      if (error instanceof AlpacaDiscoveryError) {
        return {
          candidates: [],
          failures: [{ view: { reason: 'scan-failed' }, cause: error }],
        }
      }
      throw error
    }
  }

  const candidates: DiscoveryCandidateView[] = []
  const failures: RigDiscoveryFailure[] = []

  for (const endpoint of endpoints) {
    throwIfCancelled(signal)
    try {
      const inspection = await alpaca.inspect(
        endpoint,
        signal === undefined ? {} : { signal },
      )
      candidates.push(candidateView(inspection))
    } catch (error) {
      throwIfCancelled(signal)
      if (error instanceof AlpacaProviderError) {
        failures.push({
          view: { endpoint, reason: failureReason(error) },
          cause: error,
        })
        continue
      }
      throw error
    }
  }

  return { candidates, failures }
}
