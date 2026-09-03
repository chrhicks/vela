import type { DeviceKind } from '@vela/model/device'
import type {
  DiscoveryCandidateDisposition,
  DiscoveryCandidateView,
  DiscoveryFailureView,
  DiscoveryResultView,
  RigDeviceView,
  RigEndpoint,
  RigServerView,
} from '@vela/model/rig'
import { api, ApiError } from '../../lib/api'

export type DiscoverRigsRequest =
  | { mode: 'scan' }
  | { mode: 'manual'; host: string; port: number }

export class DiscoverRigsError extends Error {
  constructor(readonly reason: 'invalid-request') {
    super('The discovery request is invalid')
    this.name = 'DiscoverRigsError'
  }
}

export async function discoverRigs(
  request: DiscoverRigsRequest,
  signal: AbortSignal,
): Promise<DiscoveryResultView> {
  try {
    const response = await api<unknown>('rigs/discovery', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal,
    })
    if (!isDiscoveryResult(response)) throw new Error('Invalid discovery response')
    return response
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) {
      throw new DiscoverRigsError('invalid-request')
    }
    throw error
  }
}

const deviceKinds: ReadonlySet<string> = new Set([
  'camera',
  'cover-calibrator',
  'dome',
  'filter-wheel',
  'focuser',
  'observing-conditions',
  'rotator',
  'safety-monitor',
  'switch',
  'telescope',
  'unknown',
] satisfies ReadonlyArray<DeviceKind>)

const failureReasons: ReadonlySet<string> = new Set([
  'scan-failed',
  'unreachable',
  'invalid-response',
  'protocol-error',
] satisfies ReadonlyArray<DiscoveryFailureView['reason']>)

function isDiscoveryResult(value: unknown): value is DiscoveryResultView {
  return isRecord(value)
    && Array.isArray(value.candidates)
    && value.candidates.every(isCandidate)
    && Array.isArray(value.failures)
    && value.failures.every(isFailure)
}

function isCandidate(value: unknown): value is DiscoveryCandidateView {
  return isRecord(value)
    && isEndpoint(value.endpoint)
    && (value.server === undefined || isServer(value.server))
    && isIsoDateTime(value.inspectedAt)
    && Array.isArray(value.devices)
    && value.devices.every(isDevice)
    && isDisposition(value.disposition)
}

function isFailure(value: unknown): value is DiscoveryFailureView {
  return isRecord(value)
    && (value.endpoint === undefined || isEndpoint(value.endpoint))
    && typeof value.reason === 'string'
    && failureReasons.has(value.reason)
}

function isEndpoint(value: unknown): value is RigEndpoint {
  return isRecord(value)
    && typeof value.host === 'string'
    && value.host.trim().length > 0
    && value.host === value.host.trim()
    && Number.isInteger(value.port)
    && Number(value.port) >= 1
    && Number(value.port) <= 65535
}

function isServer(value: unknown): value is RigServerView {
  return isRecord(value)
    && isOptionalString(value.name)
    && isOptionalString(value.manufacturer)
    && isOptionalString(value.manufacturerVersion)
    && isOptionalString(value.location)
}

function isDevice(value: unknown): value is RigDeviceView {
  return isRecord(value)
    && typeof value.kind === 'string'
    && deviceKinds.has(value.kind)
    && typeof value.name === 'string'
}

function isDisposition(value: unknown): value is DiscoveryCandidateDisposition {
  if (!isRecord(value)) return false

  switch (value.state) {
    case 'new':
    case 'conflict':
      return true
    case 'ineligible':
      return value.reason === 'no-stable-device-id'
    case 'already-added':
      return typeof value.rigId === 'string' && value.rigId.trim().length > 0
    default:
      return false
  }
}

function isIsoDateTime(value: unknown): value is string {
  if (typeof value !== 'string') return false

  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && date.toISOString() === value
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
